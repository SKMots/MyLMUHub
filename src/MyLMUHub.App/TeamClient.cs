using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using MyLMUHub.Core;

namespace MyLMUHub.App;

/// <summary>The app's side of the team server (server/ in the repo; owner 2026-11-16). The hub's Team page asks for an action by name (/api/team?op=...,
/// DashServer: only on this PC, only with the page's own header); this class makes the one matching request to the team server. Your member key never
/// reaches a page: it is kept in %AppData%\MyLMUHub\team.json encrypted for your Windows account (DPAPI) and only sent to the server you connected to,
/// over HTTPS (plain http only to this PC, for testing). Race results are built here from the game's results file (the same reading as the Review tab), so
/// what is sent is only the numbers and names the server accepts.</summary>
public sealed class TeamClient
{
    sealed class Saved
    {
        public string Url { get; set; } = ""; public string Key { get; set; } = "";
        public Dictionary<long, bool> Auto { get; set; } = new();          // per team: send the races recognised as this team's by itself
        public Dictionary<long, bool> Share { get; set; } = new();         // per team: share my race pace (default on)
        public List<string> Dismissed { get; set; } = new();               // race ids marked "not a team race"
        public string LiveShare { get; set; } = "events";                   // your live sessions to your teams: "events" (2 h+ races), "all", "off"
        public bool MyStats { get; set; } = true;                           // my own race pace sheet on the website (Me page, only you see it)
    }
    Saved opts = new();
    readonly string file;
    readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(12) };
    readonly PaceService pace;
    string url = "", key = "";
    static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    public TeamClient(PaceService pace, string dir = null)                                 // dir: a test's own folder (else %AppData%\MyLMUHub)
    {
        this.pace = pace; file = Path.Combine(dir ?? AppPaths.Dir, "team.json");
        try
        {
            if (File.Exists(file))
            {
                var s = JsonSerializer.Deserialize<Saved>(File.ReadAllText(file)); opts = s ?? new Saved();
                url = s?.Url ?? ""; key = s == null || s.Key.Length == 0 ? "" : Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(s.Key), null, DataProtectionScope.CurrentUser));
            }
        }
        catch (Exception) { key = ""; }
        http.DefaultRequestHeaders.UserAgent.ParseAdd("MyLMUHub");
        // races recognised for a team with "send by itself" on: looked for every 10 minutes (and when the Team page asks)
        timer = new Timer(_ => Sync(), null, TimeSpan.FromSeconds(20), TimeSpan.FromMinutes(10));
    }
    readonly Timer timer;
    // the team races in your result files, sent (owner 2026-11-16: always automatic, no manual adding): 20 s after the start, every 10 minutes, and right after
    // you connect, set up the server, make a team or join one (a new member's files are checked at once)
    void Sync() { if (url.Length > 0 && key.Length > 0) _ = Suggest(true); }
    void Save()
    {
        var k = key.Length == 0 ? "" : Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(key), null, DataProtectionScope.CurrentUser));
        opts.Url = url; opts.Key = k;
        Directory.CreateDirectory(Path.GetDirectoryName(file)); File.WriteAllText(file, JsonSerializer.Serialize(opts));
    }

    /// <summary>"https://lmuhub.example.com" as typed -> its base address; null = not a server address the app will talk to.</summary>
    public static string NormUrl(string u)
    {
        if (string.IsNullOrWhiteSpace(u)) return null;
        u = u.Trim(); if (!u.Contains("://")) u = "https://" + u;
        if (!Uri.TryCreate(u, UriKind.Absolute, out var x) || x.UserInfo.Length > 0 || x.Query.Length > 0 || x.Fragment.Length > 0) return null;
        bool local = x.IsLoopback;
        if (x.Scheme != "https" && !(x.Scheme == "http" && local)) return null;          // only HTTPS (a test server on this PC: http)
        return x.GetLeftPart(UriPartial.Authority) + x.AbsolutePath.TrimEnd('/');
    }

    async Task<(int Code, string Body)> Call(HttpMethod m, string path, object body = null, bool withKey = true)
    {
        if (url.Length == 0) return (409, "{\"error\":\"not connected\"}");
        var req = new HttpRequestMessage(m, url + path);
        if (withKey && key.Length > 0) req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", key);
        if (body != null) req.Content = new StringContent(JsonSerializer.Serialize(body, Web), Encoding.UTF8, "application/json");
        try
        {
            using var res = await http.SendAsync(req);
            var text = await res.Content.ReadAsStringAsync();
            if (text.Length > 2_000_000) return (502, "{\"error\":\"answer too big\"}");
            return ((int)res.StatusCode, text.Length == 0 ? "{}" : text);
        }
        catch (Exception ex) { return (502, JsonSerializer.Serialize(new { error = "cannot reach the server: " + ex.Message })); }
    }

    static JsonNode Parse(string body) { try { return JsonNode.Parse(body); } catch (Exception) { return null; } }
    static string S(JsonNode n, string k) => n?[k] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
    static double D(JsonNode n, string k) => n?[k] is JsonValue v && v.TryGetValue<double>(out var d) && double.IsFinite(d) ? d : 0;
    static long L(JsonNode n, string k) => n?[k] is JsonValue v && v.TryGetValue<long>(out var l) ? l : n?[k] is JsonValue v2 && v2.TryGetValue<double>(out var d) ? (long)d : -1;

    /// <summary>One action of the Team page. body = the page's JSON (small). -> (HTTP code, JSON for the page)</summary>
    public async Task<(int, string)> Do(string op, string body)
    {
        var b = Parse(string.IsNullOrEmpty(body) ? "{}" : body) ?? new JsonObject();
        long team = L(b, "team"), user = L(b, "user"), id = L(b, "id");
        switch (op)
        {
            case "status":
            {
                if (url.Length == 0) return (200, "{\"connected\":false}");
                var (hc, hb) = await Call(HttpMethod.Get, "/api/v1/health", withKey: false);
                var h = Parse(hb); bool setup = h?["setup"] is JsonValue sv && sv.TryGetValue<bool>(out var su) && su;
                if (key.Length == 0) return (200, JsonSerializer.Serialize(new { connected = true, url, reachable = hc == 200, setup, member = false, liveShare = LiveShare, myStats = opts.MyStats }));
                var (mc, mb) = await Call(HttpMethod.Get, "/api/v1/me");
                if (mc == 401) { key = ""; Save(); }                                              // removed from every team / a new key elsewhere
                return (200, "{\"connected\":true,\"url\":" + JsonSerializer.Serialize(url) + ",\"reachable\":" + (hc == 200 ? "true" : "false") + ",\"setup\":" + (setup ? "true" : "false") +
                    ",\"member\":" + (mc == 200 ? "true" : "false") + ",\"liveShare\":\"" + LiveShare + "\",\"myStats\":" + (opts.MyStats ? "true" : "false") + ",\"me\":" + (mc == 200 ? mb : "null") + "}");
            }
            case "connect":
            {
                var u = NormUrl(S(b, "url")); if (u == null) return (400, "{\"error\":\"use the server's https:// address\"}");
                var old = url; url = u;
                var (hc, hb) = await Call(HttpMethod.Get, "/api/v1/health", withKey: false);
                if (hc != 200 || Parse(hb)?["version"] == null) { url = old; return (502, "{\"error\":\"no My LMU Hub team server at that address\"}"); }
                if (u != old) key = "";
                Save(); return (200, "{\"ok\":true}");
            }
            case "disconnect": url = ""; key = ""; Save(); return (200, "{\"ok\":true}");
            case "setup":
            case "join":
            {
                var (c, r) = op == "setup" ? await Call(HttpMethod.Post, "/api/v1/setup", new { setupKey = S(b, "setupKey"), name = S(b, "name") }, false)
                                           : await Call(HttpMethod.Post, "/api/v1/join", new { code = S(b, "code"), name = S(b, "name") });
                var k = S(Parse(r), "key"); if (c == 200 && !string.IsNullOrEmpty(k)) { key = k; Save(); }
                if (c == 200) Sync();
                return (c, c == 200 ? "{\"ok\":true}" : r);                                       // the key itself never goes to the page
            }
            case "rename": return await Call(HttpMethod.Post, "/api/v1/me/name", new { name = S(b, "name") });
            case "createTeam": { var r = await Call(HttpMethod.Post, "/api/v1/teams", new { name = S(b, "name") }); if (r.Item1 == 200) Sync(); return r; }
            // the team logo (owner: set / remove; the server keeps a PNG rebuilt from its pixels only); "logo" = the picture for the page (base64, PNG only)
            case "setLogo": return team > 0 ? await Call(HttpMethod.Post, $"/api/v1/teams/{team}/logo", new { png = S(b, "png") }) : (400, "{}");
            case "removeLogo": return team > 0 ? await Call(HttpMethod.Delete, $"/api/v1/teams/{team}/logo") : (400, "{}");
            case "logo":
            {
                if (team <= 0 || url.Length == 0) return (400, "{}");
                try
                {
                    var req = new HttpRequestMessage(HttpMethod.Get, url + $"/api/v1/teams/{team}/logo");
                    if (key.Length > 0) req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", key);
                    using var res = await http.SendAsync(req);
                    if (!res.IsSuccessStatusCode) return ((int)res.StatusCode, "{}");
                    var bytes = await res.Content.ReadAsByteArrayAsync();
                    bool png = bytes.Length > 8 && bytes.Length < 300_000 && bytes[0] == 137 && bytes[1] == 80 && bytes[2] == 78 && bytes[3] == 71;   // a PNG, nothing else goes to the page
                    return png ? (200, JsonSerializer.Serialize(new { png = Convert.ToBase64String(bytes) })) : (502, "{}");
                }
                catch (Exception) { return (502, "{}"); }
            }
            case "renameTeam": return team > 0 ? await Call(HttpMethod.Post, $"/api/v1/teams/{team}/name", new { name = S(b, "name") }) : (400, "{}");
            case "renameMember": return team > 0 && user > 0 ? await Call(HttpMethod.Post, $"/api/v1/teams/{team}/members/{user}/name", new { name = S(b, "name") }) : (400, "{}");
            case "members": return team > 0 ? await Call(HttpMethod.Get, $"/api/v1/teams/{team}/members") : (400, "{}");
            case "invite": return team > 0 ? await Call(HttpMethod.Post, $"/api/v1/teams/{team}/invites", new { roles = b["roles"]?.AsArray().Select(x => x?.ToString()).ToArray(), days = L(b, "days") }) : (400, "{}");
            case "roles": return team > 0 && user > 0 ? await Call(HttpMethod.Post, $"/api/v1/teams/{team}/members/{user}/roles", new { roles = b["roles"]?.AsArray().Select(x => x?.ToString()).ToArray() }) : (400, "{}");
            case "remove":
            {
                var r = team > 0 && user > 0 ? await Call(HttpMethod.Delete, $"/api/v1/teams/{team}/members/{user}") : (400, "{}");
                return r;
            }
            case "results": return team > 0 ? await Call(HttpMethod.Get, $"/api/v1/teams/{team}/results") : (400, "{}");
            case "result": return team > 0 && id > 0 ? await Call(HttpMethod.Get, $"/api/v1/teams/{team}/results/{id}") : (400, "{}");
            case "deleteResult": return team > 0 && id > 0 ? await Call(HttpMethod.Delete, $"/api/v1/teams/{team}/results/{id}") : (400, "{}");
            case "send":
            {
                if (team <= 0) return (400, "{}");
                var res = BuildResult(pace?.RaceSummary(S(b, "file"))); if (res == null) return (404, "{\"error\":\"no race with your car in that file\"}");
                return await Call(HttpMethod.Post, $"/api/v1/teams/{team}/results", res);
            }
            case "suggest": return (200, JsonSerializer.Serialize(await Suggest(false), Web));
            // team-mates' live sessions (the Team tab), and your share setting
            case "live":
            {
                var (c, b2) = await Call(HttpMethod.Get, "/api/v1/live"); if (c == 200 && Parse(b2) is JsonArray a) liveList = a;
                return (c, b2);
            }
            // ---- my stats on the website: your own race pace sheet (hub.js sends it when your results change), only for you ----
            case "myStats":
            {
                bool on = b?["value"] is JsonValue mv && mv.TryGetValue<bool>(out var mb2) && mb2;
                opts.MyStats = on; Save();
                if (!on && key.Length > 0) await Call(HttpMethod.Delete, "/api/v1/me/pace");          // off = taken off the server too
                return (200, JsonSerializer.Serialize(new { value = opts.MyStats }));
            }
            case "myPace":
            {
                if (key.Length == 0 || !opts.MyStats) return (200, "{\"off\":true}");
                if (b["rows"] is not JsonArray rows || rows.Count > 400) return (400, "{}");
                return await Call(HttpMethod.Post, "/api/v1/me/pace", new { rows = rows.Select(r => new
                {
                    track = S(r, "track"), car = S(r, "car"), cls = S(r, "cls") ?? "", best = D(r, "best"), optimal = D(r, "optimal"), pace = D(r, "pace"), sd = D(r, "sd"),
                    clean = (int)Math.Max(0, L(r, "clean")), laps = (int)Math.Max(0, L(r, "laps")), last = L(r, "last"),
                    refPace = D(r, "refPace"), refHot = D(r, "refHot"), sessions = (int)Math.Max(0, L(r, "sessions")), cars = (int)Math.Max(0, L(r, "cars"))
                }).ToArray() });
            }
            case "liveShare":
            {
                var v = S(b, "value"); if (v is "events" or "all" or "off") { opts.LiveShare = v; Save(); if (v == "off") StopLive(); }
                return (200, JsonSerializer.Serialize(new { value = LiveShare }));
            }
            // ---- your phone (the website): a pairing code, Discord, log out every phone ----
            case "pair": return await Call(HttpMethod.Post, "/api/v1/web/pair", new { });
            case "logoutPhones": return await Call(HttpMethod.Post, "/api/v1/web/logout-all", new { });
            case "discordUnlink": return await Call(HttpMethod.Post, "/api/v1/discord/unlink", new { });
            case "discordLink":
            {
                var (dc, db) = await Call(HttpMethod.Post, "/api/v1/discord/link", new { });
                var u = dc == 200 ? S(Parse(db), "url") : null;
                // only ever Discord's own sign-in page, in your browser
                if (u == null || !u.StartsWith("https://discord.com/oauth2/authorize?", StringComparison.Ordinal)) return (dc == 200 ? 502 : dc, dc == 200 ? "{\"error\":\"unexpected answer\"}" : db);
                try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(u) { UseShellExecute = true }); } catch (Exception) { return (500, "{\"error\":\"could not open the browser\"}"); }
                return (200, "{\"ok\":true}");
            }
            case "settings":
            {
                if (team > 0 && b["auto"] is JsonValue av && av.TryGetValue<bool>(out var a)) opts.Auto[team] = a;
                if (team > 0 && b["share"] is JsonValue sv2 && sv2.TryGetValue<bool>(out var sh)) opts.Share[team] = sh;
                var dk = S(b, "dismiss"); if (dk != null && dk.Length == 64 && !opts.Dismissed.Contains(dk)) { opts.Dismissed.Add(dk); if (opts.Dismissed.Count > 500) opts.Dismissed.RemoveAt(0); }
                var uk = S(b, "undismiss"); if (uk != null) opts.Dismissed.Remove(uk);
                Save(); return (200, "{\"ok\":true}");
            }
            case "pace": return team > 0 ? await Call(HttpMethod.Get, $"/api/v1/teams/{team}/pace") : (400, "{}");
            case "sharePace":
            {
                if (team <= 0 || b["rows"] is not JsonArray rows || rows.Count > 400) return (400, "{}");
                if (opts.Share.TryGetValue(team, out var on) && !on) return (200, "{\"off\":true}");
                return await Call(HttpMethod.Post, $"/api/v1/teams/{team}/pace", new { rows = rows.Select(r => new
                {
                    track = S(r, "track"), car = S(r, "car"), cls = S(r, "cls") ?? "", best = D(r, "best"), optimal = D(r, "optimal"), pace = D(r, "pace"), sd = D(r, "sd"),
                    clean = (int)Math.Max(0, L(r, "clean")), laps = (int)Math.Max(0, L(r, "laps")), last = L(r, "last")
                }).ToArray() });
            }
            case "preview": { var res = BuildResult(pace?.RaceSummary(S(b, "file"))); return res == null ? (404, "{}") : (200, JsonSerializer.Serialize(res, Web)); }
            default: return (404, "{\"error\":\"unknown action\"}");
        }
    }

    /// <summary>A race of your car (results file) as the team server takes it: track, when, length, the car's result, each driver's laps / best / average of
    /// clean laps, the stints. Key = SHA-256 of the race (track, layout, start), the car and the day: a team-mate sending the same race from their own file
    /// gives the same key (counted once).</summary>
    public static object BuildResult(PaceService.RaceSum d, string keyAs = null)
    {
        if (d == null) return null;
        var laps = d.Laps;
        double Avg(IEnumerable<double> ts) { var l = ts.ToList(); if (l.Count == 0) return 0; var med = l.OrderBy(x => x).ElementAt(l.Count / 2); var ok = l.Where(x => x <= med * 1.07).ToList(); return ok.Count == 0 ? 0 : Math.Round(ok.Average(), 3); }
        var clean = laps.Where(l => !l.Pit && l.T > 0 && l.N > 1).ToList();
        var drivers = laps.Select(l => l.Driver).Where(n => n.Length > 0).Distinct().Take(8).Select(n => new
        {
            name = n, laps = laps.Count(l => l.Driver == n),
            best = clean.Where(l => l.Driver == n).Select(l => l.T).DefaultIfEmpty(0).Min(), avg = Avg(clean.Where(l => l.Driver == n).Select(l => l.T))
        }).ToArray();
        // stints: split after each pit lap (the in-lap)
        var stints = new List<object>(); var cur = new List<PaceService.RaceLap>();
        void Flush() { if (cur.Count == 0) return; var c = cur.Where(l => !l.Pit && l.T > 0).Select(l => l.T).ToList(); stints.Add(new { driver = cur.GroupBy(l => l.Driver).OrderByDescending(g => g.Count()).First().Key, laps = cur.Count, avg = Avg(c), best = c.DefaultIfEmpty(0).Min() }); cur = new List<PaceService.RaceLap>(); }
        foreach (var l in laps) { cur.Add(l); if (l.Pit && cur.Count > 1) Flush(); }
        Flush();
        var rkey = keyAs ?? RaceId(d);
        // every lap (the team race review, like the Review tab): [lap, time, pit, driver index, VE used, VE left, tyre left %, race clock] + tyre left per wheel; -1 = not known
        var names = drivers.Select(x => x.name).ToList();
        static double R3(double v) => double.IsFinite(v) && v >= 0 ? Math.Round(v, 3) : -1;
        var lapRows = laps.Take(2000).Select(l =>
        {
            var row = new List<double> { l.N, l.T > 0 && l.T <= 7200 ? Math.Round(l.T, 3) : -1, l.Pit ? 1 : 0, names.IndexOf(l.Driver), l.Ve > 0 && l.Ve <= 100 ? R3(l.Ve) : -1,
                l.VeLeft >= 0 && l.VeLeft <= 100 ? R3(l.VeLeft) : -1, l.Wear >= 0 && l.Wear <= 100 ? R3(l.Wear) : -1, l.Et >= 0 && l.Et <= 1_000_000 ? R3(l.Et) : -1 };
            if (l.Wheels is { Length: 4 } w && w.All(x => x >= 0 && x <= 1)) row.AddRange(w.Select(x => Math.Round(x, 3)));
            return row.ToArray();
        }).ToArray();
        return new
        {
            key = rkey, track = Clip(d.Track, 80), date = d.Time, length = d.Length > 0 ? d.Length : laps.Count, lengthKind = d.Length > 0 ? "time" : "laps",
            car = Clip(d.CarType, 80), cls = Clip(d.Cls, 30), entry = Clip(d.Vehicle, 80), teamName = Clip(d.TeamName, 80), pos = Math.Clamp(d.Pos, 0, 200), classPos = Math.Clamp(d.ClassPos, 0, 200),
            cars = Math.Clamp(d.Cars, 0, 200), classCars = Math.Clamp(d.ClassCars, 0, 200), laps = laps.Count, best = d.Best > 0 ? Math.Round(d.Best, 3) : 0,
            finish = Clip(d.Finish, 30), finishTime = d.FinishTime > 0 && d.FinishTime <= 7 * 86400 ? Math.Round(d.FinishTime, 3) : 0, lapRows, drivers = drivers.Select(x => new { name = Clip(x.name, 60), x.laps, best = Math.Round(x.best, 3), x.avg }).ToArray(), stints = stints.Take(60).ToArray()
        };
    }
    // a race's id for the team: the same in every team-mate's result files (owner 2026-11-16: a new member's races must not come twice): the race key (track,
    // layout, the race start on the server's session clock), the car entry and its team. Not the session date in the file: it differs between two PCs (a
    // 24 h race joined on another day). OldRaceId = the id up to v2.2.3-dev (with that date): races sent with it are recognised and not sent again.
    public static string RaceId(PaceService.RaceSum d) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("v2|" + d.RaceKey + "|" + d.Vehicle + "|" + d.TeamName))).ToLowerInvariant();
    public static string OldRaceId(PaceService.RaceSum d) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(d.RaceKey + "|" + DateTimeOffset.FromUnixTimeSeconds(d.Time).UtcDateTime.ToString("yyyy-MM-dd") + "|" + d.Vehicle))).ToLowerInvariant();

    // ---- which team was a race for? (owner 2026-11-16: "it should see this one is for team A, that one for team B") ----
    // Per team, the clues: the car's team name in the results file contains the team's name; the same car team name as races sent to the team before (not
    // the car entry: a personal "Custom Team #397" livery is used for several teams); a
    // team-mate in the car (a member's name, or a driver of the team's earlier races). Races of the last 60 days, 10 laps or more. A team with "send by
    // itself" on gets a race recognised for it alone (or clearly ahead), not yet there, not marked "not a team race". Only SPECIAL EVENTS (RaceResults
    // ResultSession.Special) are matched: a daily race in the team livery is not a team race.
    readonly Dictionary<string, PaceService.RaceSum> sums = new(); readonly SemaphoreSlim busy = new(1, 1);
    static string Norm(string s) => new string((s ?? "").ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());
    static string NameKey(string s) => string.Join(" ", (s ?? "").ToLowerInvariant().Split(new[] { ' ', '.', '-', '_' }, StringSplitOptions.RemoveEmptyEntries).OrderBy(x => x));
    public static List<string> Clues(PaceService.RaceSum d, string teamName, IEnumerable<string> entries, IEnumerable<string> people, ICollection<string> myNames)
    {
        var why = new List<string>(); string tn = Norm(teamName);
        if (tn.Length >= 3 && (Norm(d.TeamName).Contains(tn) || Norm(d.Vehicle).Contains(tn))) why.Add("team name \"" + (string.IsNullOrEmpty(d.TeamName) ? d.Vehicle : d.TeamName) + "\"");
        var en = Norm(d.TeamName); if (en.Length > 0 && Norm(d.Vehicle) != en && entries.Any(e => Norm(e) == en)) why.Add("same team as earlier team races");
        var mine = new HashSet<string>(myNames.Select(NameKey)); var ppl = new HashSet<string>(people.Select(NameKey));
        var mates = d.Laps.Select(l => l.Driver).Where(n => n.Length > 0).Distinct().Where(n => !mine.Contains(NameKey(n)) && ppl.Contains(NameKey(n))).ToList();
        if (mates.Count > 0) why.Add("with " + string.Join(", ", mates));
        return why;
    }
    static readonly object NoData = new { races = Array.Empty<object>(), teams = Array.Empty<object>() };
    async Task<object> Suggest(bool autoOnly)
    {
        if (url.Length == 0 || key.Length == 0 || pace == null) return NoData;
        await busy.WaitAsync();
        try
        {
            var (mc, mb) = await Call(HttpMethod.Get, "/api/v1/me"); if (mc != 200) return NoData;
            var teams = (Parse(mb)?["teams"] as JsonArray ?? new JsonArray()).Select(t => (Id: L(t, "id"), Name: S(t, "name"))).Where(t => t.Id > 0).ToList();
            var info = new List<(long Id, string Name, Dictionary<string, bool> Keys, List<string> Entries, List<string> People)>();
            foreach (var t in teams)
            {
                var (rc, rb) = await Call(HttpMethod.Get, $"/api/v1/teams/{t.Id}/results"); var (pc, pb) = await Call(HttpMethod.Get, $"/api/v1/teams/{t.Id}/members");
                var res = rc == 200 ? Parse(rb) as JsonArray ?? new JsonArray() : new JsonArray();
                var keys = new Dictionary<string, bool>();                                          // key -> sent with its laps
                foreach (var x in res) { var k = S(x?["result"], "key"); if (k != null) keys[k] = x?["laps"] is JsonValue lv && lv.TryGetValue<bool>(out var hl) && hl; }
                var entries = res.Select(x => S(x?["result"], "teamName")).Where(e => !string.IsNullOrEmpty(e)).ToList();   // the car team names of earlier team races
                var people = res.SelectMany(x => (x?["result"]?["drivers"] as JsonArray ?? new JsonArray()).Select(d => S(d, "name"))).Where(n => n != null).ToList();
                if (pc == 200) people.AddRange((Parse(pb) as JsonArray ?? new JsonArray()).Select(m => S(m, "name")).Where(n => n != null));
                info.Add((t.Id, t.Name, keys, entries, people));
            }
            long since = DateTimeOffset.UtcNow.ToUnixTimeSeconds() - 60 * 86400;
            var races = (pace.Sessions() ?? new List<PaceSession>()).Where(s => s.Type == "Race" && !s.Live && s.Time >= since && s.Laps.Count >= 10)
                .GroupBy(s => s.RaceKey.Length > 0 ? s.RaceKey : s.File).Select(g => g.OrderByDescending(s => s.Laps.Count).First()).OrderByDescending(s => s.Time).Take(40).ToList();
            var outList = new List<object>();
            foreach (var s in races)
            {
                if (!sums.TryGetValue(s.File, out var d)) { d = pace.RaceSummary(s.File); if (d == null) continue; sums[s.File] = d; }
                var id = RaceId(d); var oldId = OldRaceId(d);
                string KeyIn((long Id, string Name, Dictionary<string, bool> Keys, List<string> Entries, List<string> People) t) => t.Keys.ContainsKey(id) ? id : t.Keys.ContainsKey(oldId) ? oldId : null;
                var sentTo = info.Where(t => KeyIn(t) != null).Select(t => t.Id).ToList();
                // already there without its laps (an older app): the laps are added (the same key: no second entry)
                foreach (var t in info) { var k = KeyIn(t); if (k != null && !t.Keys[k] && d.Complete && d.Laps.Count > 0) { var (lc, _) = await Call(HttpMethod.Post, $"/api/v1/teams/{t.Id}/results", BuildResult(d, k)); if (lc == 200) t.Keys[k] = true; } }
                // only special events are team races (owner 2026-11-16: a daily race in the team livery is not); solo or with team-mates
                var cands = !d.Special ? new List<(long team, string name, List<string> why)>().Select(c => new { c.team, c.name, c.why }).ToList()
                    : info.Select(t => new { team = t.Id, name = t.Name, why = Clues(d, t.Name, t.Entries, t.People, pace.Names) }).Where(c => c.why.Count > 0).OrderByDescending(c => c.why.Count).ToList();
                bool clear = cands.Count == 1 || (cands.Count > 1 && cands[0].why.Count > cands[1].why.Count);
                string status = sentTo.Count > 0 ? "sent" : !d.Special ? "daily" : cands.Count == 0 ? "unknown" : !clear ? "unclear" : !d.Complete ? "incomplete" : "new";
                if (status == "new")
                {
                    var (sc, _) = await Call(HttpMethod.Post, $"/api/v1/teams/{cands[0].team}/results", BuildResult(d));
                    if (sc == 200) { sentTo.Add(cands[0].team); info.First(t => t.Id == cands[0].team).Keys[id] = true; status = "sent now"; }
                }
                if (autoOnly) continue;
                if (!d.Special) continue;                                                               // daily races: not team races, not listed
                outList.Add(new { file = s.File, id, status, special = d.Special, complete = d.Complete, track = d.Track, date = d.Time, laps = d.Laps.Count, classPos = d.ClassPos, classCars = d.ClassCars, cls = d.Cls, car = d.CarType,
                    teamName = d.TeamName, entry = d.Vehicle, drivers = d.Laps.Select(l => l.Driver).Where(n => n.Length > 0).Distinct().ToArray(), sentTo, candidates = cands });
            }
            return new { races = outList, teams = info.Select(t => new { id = t.Id, name = t.Name, share = !opts.Share.TryGetValue(t.Id, out var sh) || sh }) };
        }
        finally { busy.Release(); }
    }

    // ---- live sessions (owner 2026-11-16): while you drive, your car's own numbers go to your teams (every 2 s); while you spectate a team-mate whose app does
    // the same, the dashboard shows THEIR numbers (exact tyres, fuel, VE, damage). Share: "events" (default: sessions of an event with a race of 2 h or more),
    // "all", "off" (Settings). Nothing is sent without a team server and a team.
    DateTime liveSent = DateTime.MinValue, livePolled = DateTime.MinValue; volatile bool liveBusy, livePolling, liveOn;
    volatile JsonArray liveList = new();
    readonly Dictionary<string, (long At, CarView Car, TopBarView Top)> liveCars = new();
    static readonly JsonSerializerOptions LiveOpt = new(JsonSerializerDefaults.Web);
    public string LiveShare => opts.LiveShare is "all" or "off" ? opts.LiveShare : "events";
    /// <summary>The pump, while YOU drive: your car + top bar (sent at most every 2 s, never two at once).</summary>
    // this session's laps of your car (the Team tab's live view: stints and laps, like a team race): the top bar's lap counter going up = a lap done;
    // [lap, time, in the pits during it 0/1, VE used, VE left at the line]; a new session / car starts over
    string lapKey = ""; int lapSeen = -1, lapsSent = -1; bool lapPit; DateTime lapsSentAt = DateTime.MinValue; readonly List<double[]> liveLaps = new();
    void CollectLap(string key, CarView car, TopBarView top)
    {
        if (car == null || top == null) return;
        if (key != lapKey) { lapKey = key; lapSeen = top.Lap; lapPit = car.InPits; lock (liveLaps) liveLaps.Clear(); return; }
        if (car.InPits) lapPit = true;
        if (top.Lap > lapSeen && lapSeen > 0)
        {
            lock (liveLaps) { liveLaps.Add(new[] { top.Lap - 1, top.Last > 0 ? Math.Round(top.Last, 3) : -1, lapPit ? 1 : 0, car.Ve.Last > 0 ? Math.Round(car.Ve.Last, 2) : -1, car.Ve.Now >= 0 ? Math.Round(car.Ve.Now, 2) : -1 }); if (liveLaps.Count > 400) liveLaps.RemoveAt(0); }
            lapPit = car.InPits;
        }
        lapSeen = top.Lap;
    }
    public void PushLive(string track, int session, string entry, string driver, double eventMinutes, object car, object top)
    {
        CollectLap(track + "|" + session + "|" + entry, car as CarView, top as TopBarView);
        if (url.Length == 0 || key.Length == 0 || LiveShare == "off" || (LiveShare == "events" && !(eventMinutes >= 120))) { StopLive(); return; }
        if (liveBusy || (DateTime.UtcNow - liveSent).TotalSeconds < 2) return;
        liveBusy = true; liveSent = DateTime.UtcNow; liveOn = true;
        // the laps only when one was added (or every 30 s): the server keeps them in between (a 24 h race: ~350 laps, not every 2 s)
        double[][] laps = null; lock (liveLaps) if (liveLaps.Count != lapsSent || (DateTime.UtcNow - lapsSentAt).TotalSeconds > 30) { laps = liveLaps.ToArray(); lapsSent = liveLaps.Count; lapsSentAt = DateTime.UtcNow; }
        var body = new { track, session, entry, driver, eventMinutes = eventMinutes > 0 ? Math.Round(eventMinutes, 1) : 0, car, top, laps };
        _ = Task.Run(async () => { try { await Call(HttpMethod.Post, "/api/v1/live", body); } finally { liveBusy = false; } });
    }
    /// <summary>Not driving any more: your live data off the server at once (else it fades out after 20 s).</summary>
    public void StopLive()
    {
        if (!liveOn || url.Length == 0 || key.Length == 0) return;
        liveOn = false; _ = Task.Run(async () => { try { await Call(HttpMethod.Delete, "/api/v1/live"); } catch (Exception) { } });
    }
    void PollLive()
    {
        if (livePolling || url.Length == 0 || key.Length == 0 || (DateTime.UtcNow - livePolled).TotalSeconds < 2) return;
        livePolling = true; livePolled = DateTime.UtcNow;
        _ = Task.Run(async () =>
        {
            try { var (c, b) = await Call(HttpMethod.Get, "/api/v1/live"); if (c == 200 && Parse(b) is JsonArray a) liveList = a; }
            finally { livePolling = false; }
        });
    }
    /// <summary>The pump, while you SPECTATE: a team-mate's live numbers for this car (same track + entry, at most 10 s old), else null (the game's own).</summary>
    public (CarView Car, TopBarView Top)? LiveFor(string track, string entry)
    {
        if (url.Length == 0 || key.Length == 0 || string.IsNullOrEmpty(entry)) return null;
        PollLive();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        foreach (var n in liveList)
        {
            if (n is not JsonObject o || (o["me"]?.GetValue<bool>() ?? false)) continue;
            if (S(o, "entry") != entry || S(o, "track") != track) continue;
            long at = L(o, "at"); if (now - at > 10_000) continue;
            lock (liveCars)
            {
                if (liveCars.TryGetValue(entry, out var c) && c.At == at) return (c.Car, c.Top);
                try
                {
                    var car = o["car"].Deserialize<CarView>(LiveOpt); var top = o["top"].Deserialize<TopBarView>(LiveOpt);
                    if (car == null || top == null) return null;
                    car.LiveFrom = S(o, "name") ?? "team-mate";
                    liveCars[entry] = (at, car, top); return (car, top);
                }
                catch (Exception) { return null; }
            }
        }
        return null;
    }

    static string Clip(string s, int n) => string.IsNullOrEmpty(s) ? "" : s.Length <= n ? s : s[..n];
}
