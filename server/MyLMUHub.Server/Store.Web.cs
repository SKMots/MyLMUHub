using Microsoft.Data.Sqlite;

namespace MyLMUHub.Server;

/// <summary>The website's part of the database (2026-11-16): phone logins (web sessions), pairing codes from the desktop app, Discord sign-in steps and the
/// Discord account linked to a member. Every token / code is random and stored only as its SHA-256 hash.</summary>
public sealed partial class Store
{
    void WebSchema(SqliteConnection c)
    {
        Exec(c, """
            CREATE TABLE IF NOT EXISTS web_sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created INTEGER NOT NULL,
                                                     expires INTEGER NOT NULL, last_seen INTEGER NOT NULL, label TEXT NOT NULL DEFAULT '');
            CREATE TABLE IF NOT EXISTS pair_codes   (code_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS oauth_states (state_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, user_id INTEGER, expires INTEGER NOT NULL);
            """);
        if (Convert.ToInt64(Scalar(c, "SELECT COUNT(*) FROM pragma_table_info('users') WHERE name = 'discord_id'")) == 0)
        {
            Exec(c, "ALTER TABLE users ADD COLUMN discord_id TEXT");
            Exec(c, "ALTER TABLE users ADD COLUMN discord_name TEXT");
        }
        Exec(c, "CREATE UNIQUE INDEX IF NOT EXISTS users_discord ON users(discord_id) WHERE discord_id IS NOT NULL");
    }

    // ---- web sessions (a phone / browser that logged in): 30 days, read-only use (Program.cs) ----
    public const int SessionDays = 30;
    public string AddSession(long user, string label)
    {
        var t = Auth.NewKey().Replace("mlh_", "mlhs_"); using var c = Open();
        Exec(c, "DELETE FROM web_sessions WHERE expires < $now", ("$now", Now));
        Exec(c, "INSERT INTO web_sessions (token_hash, user_id, created, expires, last_seen, label) VALUES ($h, $u, $now, $e, $now, $l)",
            ("$h", Auth.Hash(t)), ("$u", user), ("$now", Now), ("$e", Now + SessionDays * 86400L), ("$l", label ?? ""));
        return t;
    }
    public User UserBySession(string token)
    {
        if (string.IsNullOrEmpty(token) || token.Length > 100) return null;
        using var c = Open(); string h = Auth.Hash(token); User u; long seen;
        // the read is finished (reader closed) before the write below; "last seen" only written when it is a minute old (a phone asks every few seconds)
        using (var cmd = Cmd(c, "SELECT u.id, u.name, u.admin, s.last_seen FROM web_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $h AND s.expires >= $now", ("$h", h), ("$now", Now)))
        using (var r = cmd.ExecuteReader()) { if (!r.Read()) return null; u = new User(r.GetInt64(0), r.GetString(1), r.GetInt64(2) == 1); seen = r.GetInt64(3); }
        if (Now - seen >= 60) Exec(c, "UPDATE web_sessions SET last_seen = $now WHERE token_hash = $h", ("$now", Now), ("$h", h));
        return u;
    }
    public void EndSession(string token) { if (token == null) return; using var c = Open(); Exec(c, "DELETE FROM web_sessions WHERE token_hash = $h", ("$h", Auth.Hash(token))); }
    public int EndAllSessions(long user) { using var c = Open(); using var cmd = Cmd(c, "DELETE FROM web_sessions WHERE user_id = $u", ("$u", user)); return cmd.ExecuteNonQuery(); }
    public int Sessions(long user) { using var c = Open(); return Convert.ToInt32(Scalar(c, "SELECT COUNT(*) FROM web_sessions WHERE user_id = $u AND expires >= $now", ("$u", user), ("$now", Now))); }

    // ---- pairing codes: the desktop app makes one, the phone types it (one use, 2 minutes) ----
    public string AddPairCode(long user)
    {
        var code = Auth.NewCode()[..9]; using var c = Open();                                   // "ABCD-EFGH": 31^8 codes, alive for 2 minutes, a few tries a minute
        Exec(c, "DELETE FROM pair_codes WHERE expires < $now OR user_id = $u", ("$now", Now), ("$u", user));
        Exec(c, "INSERT INTO pair_codes (code_hash, user_id, expires) VALUES ($h, $u, $e)", ("$h", Auth.Hash(NormPair(code))), ("$u", user), ("$e", Now + 120));
        return code;
    }
    public static string NormPair(string code)
    {
        if (code == null || code.Length > 30) return null;
        var s = new string(code.Where(char.IsLetterOrDigit).Select(char.ToUpperInvariant).ToArray());
        return s.Length == 8 ? s : null;
    }
    public long? RedeemPairCode(string code)
    {
        var n = NormPair(code); if (n == null) return null;
        using var c = Open(); using var tx = c.BeginTransaction();
        var v = Scalar(c, "SELECT user_id FROM pair_codes WHERE code_hash = $h AND expires >= $now", ("$h", Auth.Hash(n)), ("$now", Now));
        if (v == null) return null;
        Exec(c, "DELETE FROM pair_codes WHERE code_hash = $h", ("$h", Auth.Hash(n)));
        tx.Commit(); return Convert.ToInt64(v);
    }

    // ---- Discord: sign-in steps (state, one use, 10 minutes) and the linked account ----
    public string AddOAuthState(string kind, long? user)
    {
        var s = Auth.NewKey()[4..]; using var c = Open();
        Exec(c, "DELETE FROM oauth_states WHERE expires < $now", ("$now", Now));
        Exec(c, "INSERT INTO oauth_states (state_hash, kind, user_id, expires) VALUES ($h, $k, $u, $e)", ("$h", Auth.Hash(s)), ("$k", kind), ("$u", user), ("$e", Now + 600));
        return s;
    }
    public (string Kind, long? User)? TakeOAuthState(string state)
    {
        if (string.IsNullOrEmpty(state) || state.Length > 100) return null;
        using var c = Open(); using var tx = c.BeginTransaction();
        using var cmd = Cmd(c, "SELECT kind, user_id FROM oauth_states WHERE state_hash = $h AND expires >= $now", ("$h", Auth.Hash(state)), ("$now", Now));
        (string, long?)? res = null;
        using (var r = cmd.ExecuteReader()) if (r.Read()) res = (r.GetString(0), r.IsDBNull(1) ? null : r.GetInt64(1));
        Exec(c, "DELETE FROM oauth_states WHERE state_hash = $h", ("$h", Auth.Hash(state)));
        tx.Commit(); return res;
    }
    /// <summary>Links a Discord account to a member. false = that Discord account is linked to someone else already.</summary>
    public bool LinkDiscord(long user, string discordId, string discordName)
    {
        using var c = Open();
        var other = Scalar(c, "SELECT id FROM users WHERE discord_id = $d AND id <> $u", ("$d", discordId), ("$u", user));
        if (other != null) return false;
        Exec(c, "UPDATE users SET discord_id = $d, discord_name = $n WHERE id = $u", ("$d", discordId), ("$n", discordName), ("$u", user));
        return true;
    }
    public void UnlinkDiscord(long user) { using var c = Open(); Exec(c, "UPDATE users SET discord_id = NULL, discord_name = NULL WHERE id = $u", ("$u", user)); }
    public long? UserByDiscord(string discordId) { using var c = Open(); var v = Scalar(c, "SELECT id FROM users WHERE discord_id = $d", ("$d", discordId)); return v == null ? null : Convert.ToInt64(v); }
    public string DiscordName(long user) { using var c = Open(); return Scalar(c, "SELECT discord_name FROM users WHERE id = $u", ("$u", user)) as string; }
}
