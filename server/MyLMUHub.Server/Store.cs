using Microsoft.Data.Sqlite;

namespace MyLMUHub.Server;

public sealed record User(long Id, string Name, bool Admin);
public sealed record Member(long UserId, string Name, Role Roles, long Joined);
public sealed record TeamOf(long Id, string Name, Role Roles);

/// <summary>The server's data in one SQLite file (data/team.db). Every value goes in as a parameter (never pasted into SQL). Race results are stored as
/// the JSON the server itself wrote from the checked fields, never the bytes a member sent.
/// Leaving a team (owner 2026-11-16): the member's personal data for that team goes; the team's race results stay, with the names in them.</summary>
public sealed partial class Store
{
    readonly string cs;
    public Store(string file)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(file))!);
        cs = new SqliteConnectionStringBuilder { DataSource = file, Mode = SqliteOpenMode.ReadWriteCreate, Cache = SqliteCacheMode.Shared }.ToString();
        using var c = Open();
        Exec(c, """
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS users   (id INTEGER PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, admin INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS teams   (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS members (team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                roles INTEGER NOT NULL, joined INTEGER NOT NULL, PRIMARY KEY (team_id, user_id));
            CREATE TABLE IF NOT EXISTS invites (code_hash TEXT PRIMARY KEY, team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE, roles INTEGER NOT NULL,
                                                expires INTEGER NOT NULL, created_by INTEGER, used_by INTEGER, used_at INTEGER);
            CREATE TABLE IF NOT EXISTS results (id INTEGER PRIMARY KEY, team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE, rkey TEXT NOT NULL,
                                                uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created INTEGER NOT NULL, track TEXT NOT NULL, date INTEGER NOT NULL,
                                                body TEXT NOT NULL, UNIQUE (team_id, rkey));
            CREATE TABLE IF NOT EXISTS pace    (team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                track TEXT NOT NULL, car TEXT NOT NULL, cls TEXT NOT NULL, best REAL, optimal REAL, pace REAL, clean INTEGER NOT NULL,
                                                laps INTEGER NOT NULL, last INTEGER NOT NULL, PRIMARY KEY (team_id, user_id, track, car));
            CREATE TABLE IF NOT EXISTS my_pace (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, track TEXT NOT NULL, car TEXT NOT NULL, cls TEXT NOT NULL,
                                                best REAL, optimal REAL, pace REAL, sd REAL, clean INTEGER NOT NULL, laps INTEGER NOT NULL, last INTEGER NOT NULL,
                                                ref_pace REAL, ref_hot REAL, sessions INTEGER NOT NULL, PRIMARY KEY (user_id, track, car));
            """);
        // added later (2026-11-16): every lap of a race (kept apart: the list of results stays small), consistency per pace row
        if (Convert.ToInt64(Scalar(c, "SELECT COUNT(*) FROM pragma_table_info('results') WHERE name = 'laps'")) == 0) Exec(c, "ALTER TABLE results ADD COLUMN laps TEXT");
        if (Convert.ToInt64(Scalar(c, "SELECT COUNT(*) FROM pragma_table_info('pace') WHERE name = 'sd'")) == 0) Exec(c, "ALTER TABLE pace ADD COLUMN sd REAL");
        WebSchema(c);                                                                         // the website: phone logins, pairing codes, Discord (Store.Web.cs)
    }

    SqliteConnection Open() { var c = new SqliteConnection(cs); c.Open(); Exec(c, "PRAGMA foreign_keys = ON;"); return c; }
    static void Exec(SqliteConnection c, string sql, params (string, object)[] p) { using var cmd = Cmd(c, sql, p); cmd.ExecuteNonQuery(); }
    static SqliteCommand Cmd(SqliteConnection c, string sql, params (string, object)[] p)
    {
        var cmd = c.CreateCommand(); cmd.CommandText = sql;
        foreach (var (k, v) in p) cmd.Parameters.AddWithValue(k, v ?? DBNull.Value);
        return cmd;
    }
    static object Scalar(SqliteConnection c, string sql, params (string, object)[] p) { using var cmd = Cmd(c, sql, p); return cmd.ExecuteScalar(); }
    public static long Now => DateTimeOffset.UtcNow.ToUnixTimeSeconds();

    // ---- users ----
    public bool AnyUser() { using var c = Open(); return Convert.ToInt64(Scalar(c, "SELECT COUNT(*) FROM users")) > 0; }
    public long AddUser(string name, string key, bool admin)
    {
        using var c = Open();
        return Convert.ToInt64(Scalar(c, "INSERT INTO users (name, key_hash, admin, created) VALUES ($n, $k, $a, $t) RETURNING id", ("$n", name), ("$k", Auth.Hash(key)), ("$a", admin ? 1 : 0), ("$t", Now)));
    }
    public User UserByKey(string key)
    {
        if (key == null) return null;
        using var c = Open(); using var cmd = Cmd(c, "SELECT id, name, admin FROM users WHERE key_hash = $k", ("$k", Auth.Hash(key)));
        using var r = cmd.ExecuteReader(); return r.Read() ? new User(r.GetInt64(0), r.GetString(1), r.GetInt64(2) == 1) : null;
    }
    public void Rename(long user, string name) { using var c = Open(); Exec(c, "UPDATE users SET name = $n WHERE id = $u", ("$n", name), ("$u", user)); }
    /// <summary>A new key for this user (the old one stops working): "log out everywhere" / a lost PC.</summary>
    public string NewKeyFor(long user) { var k = Auth.NewKey(); using var c = Open(); Exec(c, "UPDATE users SET key_hash = $k WHERE id = $u", ("$k", Auth.Hash(k)), ("$u", user)); return k; }

    // ---- teams and members ----
    public long AddTeam(string name, long owner)
    {
        using var c = Open(); using var tx = c.BeginTransaction();
        long id = Convert.ToInt64(Scalar(c, "INSERT INTO teams (name, created) VALUES ($n, $t) RETURNING id", ("$n", name), ("$t", Now)));
        Exec(c, "INSERT INTO members (team_id, user_id, roles, joined) VALUES ($t, $u, $r, $j)", ("$t", id), ("$u", owner), ("$r", (int)(Role.Owner | Role.Driver)), ("$j", Now));
        tx.Commit(); return id;
    }
    public List<TeamOf> TeamsOf(long user)
    {
        using var c = Open(); using var cmd = Cmd(c, "SELECT t.id, t.name, m.roles FROM members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = $u ORDER BY t.name", ("$u", user));
        using var r = cmd.ExecuteReader(); var l = new List<TeamOf>(); while (r.Read()) l.Add(new TeamOf(r.GetInt64(0), r.GetString(1), (Role)r.GetInt64(2))); return l;
    }
    public Role RolesIn(long team, long user)
    {
        using var c = Open(); var v = Scalar(c, "SELECT roles FROM members WHERE team_id = $t AND user_id = $u", ("$t", team), ("$u", user));
        return v == null ? Role.None : (Role)Convert.ToInt64(v);
    }
    public List<Member> Members(long team)
    {
        using var c = Open(); using var cmd = Cmd(c, "SELECT u.id, u.name, m.roles, m.joined FROM members m JOIN users u ON u.id = m.user_id WHERE m.team_id = $t ORDER BY u.name", ("$t", team));
        using var r = cmd.ExecuteReader(); var l = new List<Member>(); while (r.Read()) l.Add(new Member(r.GetInt64(0), r.GetString(1), (Role)r.GetInt64(2), r.GetInt64(3))); return l;
    }
    public bool SetRoles(long team, long user, Role roles)
    {
        using var c = Open(); using var cmd = Cmd(c, "UPDATE members SET roles = $r WHERE team_id = $t AND user_id = $u", ("$r", (int)roles), ("$t", team), ("$u", user)); return cmd.ExecuteNonQuery() == 1;
    }
    public int Owners(long team) { using var c = Open(); return Convert.ToInt32(Scalar(c, "SELECT COUNT(*) FROM members WHERE team_id = $t AND (roles & 4) <> 0", ("$t", team))); }

    /// <summary>A member leaves (or is removed): out of the team; their personal data of the team is deleted (later: their laps, driving lines); the race
    /// results stay (the names in them too), only "uploaded by" is cleared. A user in no team any more is deleted (their key stops working); the server
    /// owner stays.</summary>
    public bool Remove(long team, long user)
    {
        using var c = Open(); using var tx = c.BeginTransaction();
        using (var cmd = Cmd(c, "DELETE FROM members WHERE team_id = $t AND user_id = $u", ("$t", team), ("$u", user))) if (cmd.ExecuteNonQuery() == 0) return false;
        Exec(c, "UPDATE results SET uploaded_by = NULL WHERE team_id = $t AND uploaded_by = $u", ("$t", team), ("$u", user));
        Exec(c, "DELETE FROM pace WHERE team_id = $t AND user_id = $u", ("$t", team), ("$u", user));          // personal: their race pace
        if (Convert.ToInt64(Scalar(c, "SELECT COUNT(*) FROM members WHERE user_id = $u", ("$u", user))) == 0)
            Exec(c, "DELETE FROM users WHERE id = $u AND admin = 0", ("$u", user));
        tx.Commit(); return true;
    }

    // ---- invites: one use, until they expire ----
    public string AddInvite(long team, Role roles, int days, long by)
    {
        var code = Auth.NewCode(); using var c = Open();
        Exec(c, "DELETE FROM invites WHERE expires < $now", ("$now", Now));
        Exec(c, "INSERT INTO invites (code_hash, team_id, roles, expires, created_by) VALUES ($h, $t, $r, $e, $b)",
            ("$h", Auth.Hash(Auth.NormCode(code))), ("$t", team), ("$r", (int)roles), ("$e", Now + days * 86400L), ("$b", by));
        return code;
    }
    /// <summary>Uses a code: the user joins its team with its roles (a new user is made with this name; the new key comes back). null = no such code / used / expired.</summary>
    public (long Team, long User, string Key)? Redeem(string code, long? user, string name)
    {
        var norm = Auth.NormCode(code); if (norm == null) return null;
        using var c = Open(); using var tx = c.BeginTransaction();
        long team; Role roles;
        using (var cmd = Cmd(c, "SELECT team_id, roles FROM invites WHERE code_hash = $h AND used_by IS NULL AND expires >= $now", ("$h", Auth.Hash(norm)), ("$now", Now)))
        using (var r = cmd.ExecuteReader()) { if (!r.Read()) return null; team = r.GetInt64(0); roles = (Role)r.GetInt64(1); }
        string key = null;
        long uid;
        if (user is long u) uid = u;
        else { key = Auth.NewKey(); uid = Convert.ToInt64(Scalar(c, "INSERT INTO users (name, key_hash, admin, created) VALUES ($n, $k, 0, $t) RETURNING id", ("$n", name), ("$k", Auth.Hash(key)), ("$t", Now))); }
        Exec(c, "INSERT OR IGNORE INTO members (team_id, user_id, roles, joined) VALUES ($t, $u, $r, $j)", ("$t", team), ("$u", uid), ("$r", (int)roles), ("$j", Now));
        Exec(c, "UPDATE invites SET used_by = $u, used_at = $now WHERE code_hash = $h", ("$u", uid), ("$now", Now), ("$h", Auth.Hash(norm)));
        tx.Commit(); return (team, uid, key);
    }

    // ---- race results ----
    /// <summary>Adds a result (the same race sent twice = the first one stays). false = already there.</summary>
    public bool AddResult(long team, long by, string rkey, string track, long date, string body, string laps = null)
    {
        using var c = Open(); using var cmd = Cmd(c, "INSERT OR IGNORE INTO results (team_id, rkey, uploaded_by, created, track, date, body, laps) VALUES ($t, $k, $b, $c, $tr, $d, $body, $laps)",
            ("$t", team), ("$k", rkey), ("$b", by), ("$c", Now), ("$tr", track), ("$d", date), ("$body", body), ("$laps", laps));
        if (cmd.ExecuteNonQuery() == 1) return true;
        // already there (sent by a team-mate or an older version without laps): the laps are added when they were missing
        if (laps != null) Exec(c, "UPDATE results SET laps = $laps WHERE team_id = $t AND rkey = $k AND laps IS NULL", ("$laps", laps), ("$t", team), ("$k", rkey));
        return false;
    }
    /// <summary>One race with its laps (null laps = sent without them). null = no such race in the team.</summary>
    public (string Body, string Laps)? Result(long team, long id)
    {
        using var c = Open(); using var cmd = Cmd(c, "SELECT body, laps FROM results WHERE team_id = $t AND id = $i", ("$t", team), ("$i", id));
        using var r = cmd.ExecuteReader(); return r.Read() ? (r.GetString(0), r.IsDBNull(1) ? null : r.GetString(1)) : null;
    }
    public bool HasLaps(long team, long id) { using var c = Open(); return Scalar(c, "SELECT laps IS NOT NULL FROM results WHERE team_id = $t AND id = $i", ("$t", team), ("$i", id)) is long v && v == 1; }
    public int ResultsToday(long team) { using var c = Open(); return Convert.ToInt32(Scalar(c, "SELECT COUNT(*) FROM results WHERE team_id = $t AND created > $since", ("$t", team), ("$since", Now - 86400))); }
    public List<(long Id, string Body, bool Laps)> Results(long team, int max)
    {
        using var c = Open(); using var cmd = Cmd(c, "SELECT id, body, laps IS NOT NULL FROM results WHERE team_id = $t ORDER BY date DESC LIMIT $m", ("$t", team), ("$m", max));
        using var r = cmd.ExecuteReader(); var l = new List<(long, string, bool)>(); while (r.Read()) l.Add((r.GetInt64(0), r.GetString(1), r.GetInt64(2) == 1)); return l;
    }
    // ---- race pace: each member's own sheet for the team (replaced as a whole when they send it; personal: deleted when they leave) ----
    public void SetPace(long team, long user, IEnumerable<PaceRow> rows)
    {
        using var c = Open(); using var tx = c.BeginTransaction();
        Exec(c, "DELETE FROM pace WHERE team_id = $t AND user_id = $u", ("$t", team), ("$u", user));
        foreach (var r in rows)
            Exec(c, "INSERT OR REPLACE INTO pace (team_id, user_id, track, car, cls, best, optimal, pace, clean, laps, last, sd) VALUES ($t, $u, $tr, $car, $cls, $b, $o, $p, $cl, $l, $last, $sd)",
                ("$t", team), ("$u", user), ("$tr", r.Track), ("$car", r.Car), ("$cls", r.Cls), ("$b", r.Best > 0 ? r.Best : null), ("$o", r.Optimal > 0 ? r.Optimal : null),
                ("$p", r.Pace > 0 ? r.Pace : null), ("$cl", r.Clean), ("$l", r.Laps), ("$last", r.Last), ("$sd", r.Sd > 0 ? r.Sd : null));
        tx.Commit();
    }
    // ---- my stats: your own race pace sheet, for you only (the website's Me page); replaced as a whole, deleted with the account or when you switch it off ----
    public void SetMyPace(long user, IEnumerable<PaceRow> rows)
    {
        using var c = Open(); using var tx = c.BeginTransaction();
        Exec(c, "DELETE FROM my_pace WHERE user_id = $u", ("$u", user));
        foreach (var r in rows)
            Exec(c, "INSERT OR REPLACE INTO my_pace (user_id, track, car, cls, best, optimal, pace, sd, clean, laps, last, ref_pace, ref_hot, sessions) VALUES ($u, $tr, $car, $cls, $b, $o, $p, $sd, $cl, $l, $last, $rp, $rh, $n)",
                ("$u", user), ("$tr", r.Track), ("$car", r.Car), ("$cls", r.Cls), ("$b", r.Best > 0 ? r.Best : null), ("$o", r.Optimal > 0 ? r.Optimal : null), ("$p", r.Pace > 0 ? r.Pace : null),
                ("$sd", r.Sd > 0 ? r.Sd : null), ("$cl", r.Clean), ("$l", r.Laps), ("$last", r.Last), ("$rp", r.RefPace > 0 ? r.RefPace : null), ("$rh", r.RefHot > 0 ? r.RefHot : null), ("$n", r.Sessions));
        tx.Commit();
    }
    public List<PaceRow> MyPace(long user)
    {
        using var c = Open(); using var cmd = Cmd(c, "SELECT track, car, cls, best, optimal, pace, sd, clean, laps, last, ref_pace, ref_hot, sessions FROM my_pace WHERE user_id = $u ORDER BY last DESC", ("$u", user));
        using var r = cmd.ExecuteReader(); var l = new List<PaceRow>();
        double D(int i) => r.IsDBNull(i) ? 0 : r.GetDouble(i);
        while (r.Read()) l.Add(new PaceRow { Track = r.GetString(0), Car = r.GetString(1), Cls = r.GetString(2), Best = D(3), Optimal = D(4), Pace = D(5), Sd = D(6), Clean = r.GetInt32(7), Laps = r.GetInt32(8),
            Last = r.GetInt64(9), RefPace = D(10), RefHot = D(11), Sessions = r.GetInt32(12) });
        return l;
    }
    public List<(long User, string Name, PaceRow Row)> Pace(long team)
    {
        using var c = Open(); using var cmd = Cmd(c, "SELECT p.user_id, u.name, p.track, p.car, p.cls, p.best, p.optimal, p.pace, p.clean, p.laps, p.last, p.sd FROM pace p JOIN users u ON u.id = p.user_id WHERE p.team_id = $t", ("$t", team));
        using var r = cmd.ExecuteReader(); var l = new List<(long, string, PaceRow)>();
        double D(int i) => r.IsDBNull(i) ? 0 : r.GetDouble(i);
        while (r.Read()) l.Add((r.GetInt64(0), r.GetString(1), new PaceRow { Track = r.GetString(2), Car = r.GetString(3), Cls = r.GetString(4), Best = D(5), Optimal = D(6), Pace = D(7), Clean = r.GetInt32(8), Laps = r.GetInt32(9), Last = r.GetInt64(10), Sd = D(11) }));
        return l;
    }
    public bool DeleteResult(long team, long id) { using var c = Open(); using var cmd = Cmd(c, "DELETE FROM results WHERE team_id = $t AND id = $i", ("$t", team), ("$i", id)); return cmd.ExecuteNonQuery() == 1; }
}
