using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace MyLMUHub.Server;

/// <summary>Live sessions (2026-11-16): a member's desktop app, while they drive, sends its car's own live numbers (the dashboard's car + top bar) every
/// couple of seconds; team-mates see them: a team-mate's app that spectates that car shows them on its dashboard (exact tyres, fuel, VE, damage), the Team
/// tab shows "X is in a race". Kept in MEMORY only (gone 20 s after the last update or when the server restarts), never written to disk.
/// Only plain data is accepted: objects, arrays, numbers, true / false and short text, a few levels deep, at most 24 KB, keys of letters and digits. Visible
/// to the members who share a team with the sender (and the sender), nobody else.</summary>
public static class Live
{
    public sealed class LiveReq
    {
        public string Track { get; set; } public int Session { get; set; } public string Entry { get; set; } public string Driver { get; set; }
        public double EventMinutes { get; set; }
        public JsonElement Car { get; set; } public JsonElement Top { get; set; }
        public JsonElement Laps { get; set; }        // optional: this session's laps of the driver, [lap, time, in the pits 0/1, VE used, VE left] (-1 = not known)
    }
    sealed record Entry(DateTime At, long User, string Json);
    static readonly Regex KeyRx = new("^[A-Za-z][A-Za-z0-9]{0,30}$", RegexOptions.CultureInvariant);
    const int MaxBytes = 24 * 1024, MaxDepth = 5, MaxNodes = 600, Fresh = 20;

    /// <summary>Plain data only (see the class): true = fine. Counts the nodes on the way.</summary>
    public static bool SafeJson(JsonElement e, int depth, ref int nodes)
    {
        if (++nodes > MaxNodes || depth > MaxDepth) return false;
        switch (e.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var p in e.EnumerateObject()) { if (!KeyRx.IsMatch(p.Name) || !SafeJson(p.Value, depth + 1, ref nodes)) return false; }
                return true;
            case JsonValueKind.Array:
                if (e.GetArrayLength() > 40) return false;
                foreach (var x in e.EnumerateArray()) if (!SafeJson(x, depth + 1, ref nodes)) return false;
                return true;
            case JsonValueKind.Number: return e.TryGetDouble(out var d) && double.IsFinite(d) && Math.Abs(d) < 1e9;
            case JsonValueKind.String: return Check.Text(e.GetString(), 80, false) != null;
            case JsonValueKind.True: case JsonValueKind.False: case JsonValueKind.Null: return true;
            default: return false;
        }
    }

    public static void Map(WebApplication app, Store store, Func<HttpContext, User> keyUser, Func<HttpContext, User> me)
    {
        IResult Err(int code, string why) => Results.Json(new { error = why }, statusCode: code);
        var now = new ConcurrentDictionary<long, Entry>();                                       // this server's live sessions (memory only)

        // the driver's app: its live numbers (the member key only)
        app.MapPost("/api/v1/live", (HttpContext ctx, LiveReq r) =>
        {
            var u = keyUser(ctx); if (u == null) return Err(401, "no key");
            if (now.TryGetValue(u.Id, out var last) && (DateTime.UtcNow - last.At).TotalSeconds < 1) return Results.Json(new { ok = true, skipped = true });   // at most once a second
            string track = Check.Text(r?.Track, 80), entry = Check.Text(r?.Entry, 80), driver = Check.Text(r?.Driver, 60, false);
            if (track == null || entry == null || driver == null || r.Session is < 0 or > 20 || !(r.EventMinutes == 0 || Check.Num(r.EventMinutes, 1, 10080))) return Err(400, "live");
            if (r.Car.ValueKind != JsonValueKind.Object || r.Top.ValueKind != JsonValueKind.Object) return Err(400, "live: car / top");
            if (r.Car.GetRawText().Length + r.Top.GetRawText().Length > MaxBytes) return Err(413, "live: too big");
            int n = 0; if (!SafeJson(r.Car, 0, ref n) || !SafeJson(r.Top, 0, ref n)) return Err(400, "live: not plain data");
            JsonArray laps = null;
            if (r.Laps.ValueKind == JsonValueKind.Array)
            {
                if (r.Laps.GetArrayLength() > 400) return Err(400, "live: laps");
                laps = new JsonArray();
                foreach (var row in r.Laps.EnumerateArray())
                {
                    if (row.ValueKind != JsonValueKind.Array || row.GetArrayLength() is < 2 or > 6) return Err(400, "live: lap row");
                    var a = new JsonArray();
                    foreach (var v in row.EnumerateArray()) { if (v.ValueKind != JsonValueKind.Number || !v.TryGetDouble(out var d) || !double.IsFinite(d) || Math.Abs(d) > 1e6) return Err(400, "live: lap value"); a.Add(Math.Round(d, 3)); }
                    laps.Add(a);
                }
            }
            else if (r.Laps.ValueKind is not (JsonValueKind.Undefined or JsonValueKind.Null)) return Err(400, "live: laps");
            var o = new JsonObject
            {
                ["user"] = u.Id, ["name"] = u.Name, ["track"] = track, ["session"] = r.Session, ["entry"] = entry, ["driver"] = driver, ["eventMinutes"] = r.EventMinutes,
                ["at"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), ["car"] = JsonNode.Parse(r.Car.GetRawText()), ["top"] = JsonNode.Parse(r.Top.GetRawText()), ["laps"] = laps ?? (last != null ? JsonNode.Parse(last.Json)?["laps"]?.DeepClone() : null) ?? new JsonArray()
            };
            now[u.Id] = new Entry(DateTime.UtcNow, u.Id, o.ToJsonString());
            return Results.Json(new { ok = true });
        });
        app.MapDelete("/api/v1/live", (HttpContext ctx) => { var u = keyUser(ctx); if (u == null) return Err(401, "no key"); now.TryRemove(u.Id, out _); return Results.Json(new { ok = true }); });

        // team-mates' live sessions (and your own): the desktop app spectating, the Team tab, the phone
        app.MapGet("/api/v1/live", (HttpContext ctx) =>
        {
            var u = me(ctx); if (u == null) return Err(401, "no key");
            var mine = store.TeamsOf(u.Id).Select(t => t.Id).ToHashSet(); var cut = DateTime.UtcNow.AddSeconds(-Fresh);
            foreach (var kv in now) if (kv.Value.At < cut) now.TryRemove(kv.Key, out _);
            var list = new List<JsonNode>();
            foreach (var e in now.Values)
            {
                var theirs = e.User == u.Id ? null : store.TeamsOf(e.User).Where(t => mine.Contains(t.Id)).Select(t => t.Name).ToList();
                if (theirs != null && theirs.Count == 0) continue;                                     // no team in common: not yours to see
                var n = JsonNode.Parse(e.Json)!; n["me"] = e.User == u.Id; n["teams"] = new JsonArray((theirs ?? new()).Select(x => (JsonNode)x).ToArray());
                list.Add(n);
            }
            return Results.Content(new JsonArray(list.ToArray()).ToJsonString(), "application/json");
        });
    }
}
