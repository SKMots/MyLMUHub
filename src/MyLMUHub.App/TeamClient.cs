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
    sealed class Saved { public string Url { get; set; } = ""; public string Key { get; set; } = ""; }
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
                var s = JsonSerializer.Deserialize<Saved>(File.ReadAllText(file));
                url = s?.Url ?? ""; key = s == null || s.Key.Length == 0 ? "" : Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(s.Key), null, DataProtectionScope.CurrentUser));
            }
        }
        catch (Exception) { key = ""; }
        http.DefaultRequestHeaders.UserAgent.ParseAdd("MyLMUHub");
    }
    void Save()
    {
        var k = key.Length == 0 ? "" : Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(key), null, DataProtectionScope.CurrentUser));
        Directory.CreateDirectory(Path.GetDirectoryName(file)); File.WriteAllText(file, JsonSerializer.Serialize(new Saved { Url = url, Key = k }));
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
                if (key.Length == 0) return (200, JsonSerializer.Serialize(new { connected = true, url, reachable = hc == 200, setup, member = false }));
                var (mc, mb) = await Call(HttpMethod.Get, "/api/v1/me");
                if (mc == 401) { key = ""; Save(); }                                              // removed from every team / a new key elsewhere
                return (200, "{\"connected\":true,\"url\":" + JsonSerializer.Serialize(url) + ",\"reachable\":" + (hc == 200 ? "true" : "false") + ",\"setup\":" + (setup ? "true" : "false") +
                    ",\"member\":" + (mc == 200 ? "true" : "false") + ",\"me\":" + (mc == 200 ? mb : "null") + "}");
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
                return (c, c == 200 ? "{\"ok\":true}" : r);                                       // the key itself never goes to the page
            }
            case "rename": return await Call(HttpMethod.Post, "/api/v1/me/name", new { name = S(b, "name") });
            case "createTeam": return await Call(HttpMethod.Post, "/api/v1/teams", new { name = S(b, "name") });
            case "members": return team > 0 ? await Call(HttpMethod.Get, $"/api/v1/teams/{team}/members") : (400, "{}");
            case "invite": return team > 0 ? await Call(HttpMethod.Post, $"/api/v1/teams/{team}/invites", new { roles = b["roles"]?.AsArray().Select(x => x?.ToString()).ToArray(), days = L(b, "days") }) : (400, "{}");
            case "roles": return team > 0 && user > 0 ? await Call(HttpMethod.Post, $"/api/v1/teams/{team}/members/{user}/roles", new { roles = b["roles"]?.AsArray().Select(x => x?.ToString()).ToArray() }) : (400, "{}");
            case "remove":
            {
                var r = team > 0 && user > 0 ? await Call(HttpMethod.Delete, $"/api/v1/teams/{team}/members/{user}") : (400, "{}");
                return r;
            }
            case "results": return team > 0 ? await Call(HttpMethod.Get, $"/api/v1/teams/{team}/results") : (400, "{}");
            case "deleteResult": return team > 0 && id > 0 ? await Call(HttpMethod.Delete, $"/api/v1/teams/{team}/results/{id}") : (400, "{}");
            case "send":
            {
                if (team <= 0) return (400, "{}");
                var res = BuildResult(pace?.RaceSummary(S(b, "file"))); if (res == null) return (404, "{\"error\":\"no race with your car in that file\"}");
                return await Call(HttpMethod.Post, $"/api/v1/teams/{team}/results", res);
            }
            case "preview": { var res = BuildResult(pace?.RaceSummary(S(b, "file"))); return res == null ? (404, "{}") : (200, JsonSerializer.Serialize(res, Web)); }
            default: return (404, "{\"error\":\"unknown action\"}");
        }
    }

    /// <summary>A race of your car (results file) as the team server takes it: track, when, length, the car's result, each driver's laps / best / average of
    /// clean laps, the stints. Key = SHA-256 of the race (track, layout, start), the car and the day: a team-mate sending the same race from their own file
    /// gives the same key (counted once).</summary>
    public static object BuildResult(PaceService.RaceSum d)
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
        var rkey = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(d.RaceKey + "|" + DateTimeOffset.FromUnixTimeSeconds(d.Time).UtcDateTime.ToString("yyyy-MM-dd") + "|" + d.Vehicle))).ToLowerInvariant();
        return new
        {
            key = rkey, track = Clip(d.Track, 80), date = d.Time, length = d.Length > 0 ? d.Length : laps.Count, lengthKind = d.Length > 0 ? "time" : "laps",
            car = Clip(d.CarType, 80), cls = Clip(d.Cls, 30), entry = Clip(d.Vehicle, 80), pos = Math.Clamp(d.Pos, 0, 200), classPos = Math.Clamp(d.ClassPos, 0, 200),
            cars = Math.Clamp(d.Cars, 0, 200), classCars = Math.Clamp(d.ClassCars, 0, 200), laps = laps.Count, best = d.Best > 0 ? Math.Round(d.Best, 3) : 0,
            finish = Clip(d.Finish, 30), drivers = drivers.Select(x => new { name = Clip(x.name, 60), x.laps, best = Math.Round(x.best, 3), x.avg }).ToArray(), stints = stints.Take(60).ToArray()
        };
    }
    static string Clip(string s, int n) => string.IsNullOrEmpty(s) ? "" : s.Length <= n ? s : s[..n];
}
