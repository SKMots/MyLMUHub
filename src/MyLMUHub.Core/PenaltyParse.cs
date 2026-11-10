using System.Text.Json;
using System.Text.RegularExpressions;

namespace MyLMUHub.Core;

/// <summary>A car's outstanding penalties by kind: drive-throughs, stop-and-goes (counts) and time penalties (seconds added).</summary>
public sealed record PenaltyKinds(int DriveThrough, int StopGo, double Seconds);

/// <summary>Penalty KINDS from the game's UI websocket (ws://127.0.0.1:6398/websocket/ui, topic "LiveStandings"): shared memory only counts penalties
/// (mNumPenalties). NOT VERIFIED LIVE: the shape is taken from the open-source irdashies overlay (MIT), which read it from another plugin:
/// {"messageType":"PUB","topic":"LiveStandings","body":{"entries":[{"driverName":"..","position":1,"penalties":{"DT":1,"SG":0,"TIME":0}}]}}.
/// So the search is loose: any object with a driver name and a penalties object, at any depth, keys in any case. The raw frame is saved by the app
/// (webapi\livestandings.json) to check it. Cars are joined by driver name (Key: lower case, a leading "#42 " car number dropped).</summary>
public static class PenaltyParse
{
    static readonly string[] NameKeys = { "drivername", "name", "driver" }, PenKeys = { "penalties", "penalty" };
    static readonly string[] DtKeys = { "dt", "drivethrough", "drivethru" }, SgKeys = { "sg", "stopgo", "stopandgo" }, TimeKeys = { "time", "timepenalty", "penaltytime", "timeseconds" };

    /// <summary>Driver name -> its penalties (every car found, clean ones too); null = not JSON, another topic, or no car in it.</summary>
    public static Dictionary<string, PenaltyKinds> Parse(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind == JsonValueKind.Object && Prop(root, "topic") is JsonElement t && t.ValueKind == JsonValueKind.String
                && !string.Equals(t.GetString(), "LiveStandings", StringComparison.OrdinalIgnoreCase)) return null;
            var found = new Dictionary<string, PenaltyKinds>(); int nodes = 0;
            Walk(root, 0, found, ref nodes);
            return found.Count > 0 ? found : null;
        }
        catch (JsonException) { return null; }
    }

    /// <summary>The join key of a driver name: trimmed, lower case, without a leading car number ("#42 Bob" -> "bob").</summary>
    public static string Key(string name) => Regex.Replace((name ?? "").Trim(), @"^#\d+\s+", "").ToLowerInvariant();

    static void Walk(JsonElement e, int depth, Dictionary<string, PenaltyKinds> found, ref int nodes)
    {
        if (depth > 8 || ++nodes > 20000) return;
        if (e.ValueKind == JsonValueKind.Array) { foreach (var x in e.EnumerateArray()) Walk(x, depth + 1, found, ref nodes); return; }
        if (e.ValueKind != JsonValueKind.Object) return;
        string name = null; JsonElement? pen = null;
        foreach (var k in NameKeys) if (Prop(e, k) is JsonElement n && n.ValueKind == JsonValueKind.String && n.GetString().Trim().Length > 0) { name = n.GetString(); break; }
        foreach (var k in PenKeys) if (Prop(e, k) is JsonElement p) { pen = p; break; }
        if (name != null && pen != null)
        {
            var p = pen.Value; int dt = 0, sg = 0; double sec = 0;
            if (p.ValueKind == JsonValueKind.Object) { dt = (int)Num(p, DtKeys); sg = (int)Num(p, SgKeys); sec = Num(p, TimeKeys); }   // a bare number: a count without a kind
            found[Key(name)] = new PenaltyKinds(Math.Max(0, dt), Math.Max(0, sg), Math.Max(0, sec));
            return;
        }
        foreach (var x in e.EnumerateObject()) Walk(x.Value, depth + 1, found, ref nodes);
    }

    static JsonElement? Prop(JsonElement o, string key)
    {
        foreach (var x in o.EnumerateObject()) if (string.Equals(x.Name, key, StringComparison.OrdinalIgnoreCase)) return x.Value;
        return null;
    }
    static double Num(JsonElement o, string[] keys)
    {
        foreach (var k in keys)
            if (Prop(o, k) is JsonElement v)
            {
                if (v.ValueKind == JsonValueKind.Number) return v.GetDouble();
                if (v.ValueKind == JsonValueKind.String && double.TryParse(v.GetString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out double d)) return d;
                if (v.ValueKind == JsonValueKind.True) return 1;
            }
        return 0;
    }
}
