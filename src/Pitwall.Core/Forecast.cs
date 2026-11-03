using System.Text.Json;

namespace Pitwall.Core;

/// <summary>One forecast point: sky (0..10, the icon number wx_N), temperature °C, rain chance %.</summary>
public sealed class ForecastNode
{
    public int Sky { get; set; } = -1;
    public double? Temp { get; set; }
    public double? Rain { get; set; }
}

/// <summary>Weather forecast of the current session from the game's local web API (not in shared memory). Five points that start at 0, 20, 40, 60, 80 % of the
/// session (the game calls them START, NODE_25, NODE_50, NODE_75, FINISH - legacy names). ASSUMED shape (not yet verified live): an object per session type
/// (PRACTICE / QUALIFY / RACE ...) holding the five nodes, each with WNV_SKY, WNV_TEMPERATURE, WNV_RAIN_CHANCE as a number or as { "currentValue": n }.</summary>
public static class Forecast
{
    public static readonly string[] Nodes = { "START", "NODE_25", "NODE_50", "NODE_75", "FINISH" };

    public static string SessionKey(int sessionId) => sessionId <= 4 ? "PRACTICE" : sessionId <= 8 ? "QUALIFY" : sessionId == 9 ? "WARMUP" : "RACE";

    /// <summary>Null when the forecast cannot be found (never a made-up value).</summary>
    public static List<ForecastNode> Parse(string json, int sessionId)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var ses = Find(doc.RootElement, SessionKey(sessionId)) ?? (Find(doc.RootElement, Nodes[0]) != null ? doc.RootElement : (JsonElement?)null);
            if (ses == null) return null;
            var list = new List<ForecastNode>();
            foreach (string n in Nodes)
            {
                var e = Find(ses.Value, n);
                if (e == null) return null;
                double? sky = Val(e.Value, "WNV_SKY");
                list.Add(new ForecastNode { Sky = sky.HasValue ? (int)Math.Round(sky.Value) : -1, Temp = Val(e.Value, "WNV_TEMPERATURE"), Rain = Val(e.Value, "WNV_RAIN_CHANCE") });
            }
            return list.Any(x => x.Sky >= 0 || x.Temp.HasValue || x.Rain.HasValue) ? list : null;
        }
        catch (Exception) { return null; }
    }

    // a property with this name (any case), searched depth-first
    static JsonElement? Find(JsonElement e, string name)
    {
        if (e.ValueKind == JsonValueKind.Object)
        {
            foreach (var p in e.EnumerateObject()) if (string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase) && p.Value.ValueKind == JsonValueKind.Object) return p.Value;
            foreach (var p in e.EnumerateObject()) { var r = Find(p.Value, name); if (r != null) return r; }
        }
        else if (e.ValueKind == JsonValueKind.Array)
            foreach (var i in e.EnumerateArray()) { var r = Find(i, name); if (r != null) return r; }
        return null;
    }

    static double? Val(JsonElement node, string name)
    {
        foreach (var p in node.EnumerateObject())
        {
            if (!string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase)) continue;
            var v = p.Value;
            if (v.ValueKind == JsonValueKind.Object)
                foreach (var q in v.EnumerateObject())
                    if (q.Name.Equals("currentValue", StringComparison.OrdinalIgnoreCase) || q.Name.Equals("value", StringComparison.OrdinalIgnoreCase)) { v = q.Value; break; }
            if (v.ValueKind == JsonValueKind.Number) return v.GetDouble();
            if (v.ValueKind == JsonValueKind.String && double.TryParse(v.GetString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out double d)) return d;
            return null;
        }
        return null;
    }
}
