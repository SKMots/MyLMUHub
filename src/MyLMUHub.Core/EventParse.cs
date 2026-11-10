using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace MyLMUHub.Core;

/// <summary>The event the player is in, from the game's web API (verified live 2026-10-28, offline practice): the race length (also known in practice),
/// how the race ends, the lobby's fuel-use setting, the fuel / VE limits of YOUR car and the game's own laps-per-full-tank estimate. -1 / 0 / "" = not known.</summary>
public sealed class EventInfo
{
    public double RaceMinutes { get; set; } = -1;     // rest/sessions/getSessionsInfoForEvent: RACE lengthTime
    public int RaceLaps { get; set; }                 // rest/sessions: SESSSET_Race_Laps (0 = none)
    public string FinishBy { get; set; } = "";        // rest/sessions: SESSSET_Finish_Criteria as the game words it ("Time", "Laps", ...)
    public string FuelUse { get; set; } = "";         // rest/sessions: SESSSET_Fuel_Usage as the game words it ("Off", "Normal", ...)
    public double Tank { get; set; } = -1;            // getPlayerGarageData VM_FUEL_CAPACITY "83.0L": the most fuel your car can carry here (L)
    public double FuelLapsFull { get; set; } = -1;    // ... "(47.1 laps)": the game's estimate of the laps a full tank lasts
    public double VeMax { get; set; } = -1;           // VM_VIRTUAL_ENERGY value (%)
    public double VeLapsFull { get; set; } = -1;      // ... "(49.8 laps)"
}

public static class EventParse
{
    static readonly Regex Litres = new(@"([\d.]+)\s*L", RegexOptions.Compiled), Laps = new(@"\(([\d.]+)\s*laps\)", RegexOptions.Compiled);

    /// <summary>Any of the three answers may be null (not read / failed): what is there is used.</summary>
    public static EventInfo Parse(string sessionsInfo, string settings, string garage)
    {
        var e = new EventInfo();
        Try(sessionsInfo, r =>
        {
            foreach (var s in r.GetProperty("scheduledSessions").EnumerateArray())
                if (string.Equals(Str(s, "name"), "RACE", StringComparison.OrdinalIgnoreCase) && s.TryGetProperty("lengthTime", out var l) && l.ValueKind == JsonValueKind.Number) { e.RaceMinutes = l.GetDouble(); break; }
        });
        Try(settings, r =>
        {
            if (r.TryGetProperty("SESSSET_Race_Laps", out var rl) && rl.TryGetProperty("currentValue", out var v) && v.ValueKind == JsonValueKind.Number) e.RaceLaps = (int)Math.Round(v.GetDouble());
            if (r.TryGetProperty("SESSSET_Finish_Criteria", out var fc)) e.FinishBy = Str(fc, "stringValue");
            if (r.TryGetProperty("SESSSET_Fuel_Usage", out var fu)) e.FuelUse = Str(fu, "stringValue");
        });
        Try(garage, r =>
        {
            var fuel = Find(r, "VM_FUEL_CAPACITY");
            if (fuel.HasValue)
            {
                var m = Litres.Match(Str(fuel.Value, "stringValue")); if (!m.Success) m = Litres.Match(Str(fuel.Value, "lastSavedStringValue"));
                if (m.Success) e.Tank = Num(m.Groups[1].Value);
                e.FuelLapsFull = BestLaps(fuel.Value);
            }
            var ve = Find(r, "VM_VIRTUAL_ENERGY");
            if (ve.HasValue)
            {
                if (ve.Value.TryGetProperty("value", out var v) && v.ValueKind == JsonValueKind.Number) e.VeMax = v.GetDouble();
                e.VeLapsFull = BestLaps(ve.Value);
            }
        });
        return e;
    }

    // the laps estimate: the live text says "(0.0 laps)" while driving, the saved setup's text has the real one - take the larger
    static double BestLaps(JsonElement x)
    {
        double best = -1;
        foreach (var k in new[] { "stringValue", "lastSavedStringValue" })
        {
            var m = Laps.Match(Str(x, k)); if (m.Success) { double v = Num(m.Groups[1].Value); if (v > best) best = v; }
        }
        return best > 0 ? best : -1;
    }

    // the garage settings sit somewhere in a big tree: find the object with this "key"
    static JsonElement? Find(JsonElement x, string key)
    {
        if (x.ValueKind == JsonValueKind.Object)
        {
            if (x.TryGetProperty(key, out var direct) && direct.ValueKind == JsonValueKind.Object) return direct;
            foreach (var p in x.EnumerateObject()) { var f = Find(p.Value, key); if (f.HasValue) return f; }
        }
        else if (x.ValueKind == JsonValueKind.Array)
            foreach (var i in x.EnumerateArray()) { var f = Find(i, key); if (f.HasValue) return f; }
        return null;
    }

    static string Str(JsonElement x, string name) => x.ValueKind == JsonValueKind.Object && x.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
    static double Num(string s) => double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : -1;
    static void Try(string json, Action<JsonElement> read)
    {
        if (string.IsNullOrWhiteSpace(json)) return;
        try { using var d = JsonDocument.Parse(json); read(d.RootElement); } catch (Exception) { }   // one part failing leaves the others
    }
}
