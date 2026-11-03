using System.Text.Json;

namespace Pitwall.Core;

/// <summary>Aero and suspension damage from the game's web API (GET rest/garage/UIScreen/RepairAndRefuel, the repair screen of YOUR car).
/// Shape as TinyPedal reads it (lmu_restapi.py): wearables.body.aero = aero damage, wearables.suspension = damage per wheel (FL FR RL RR), as fractions
/// (0 = none, 1 = totaled). Without "wearables": any number whose name says aero / suspension + damage (older guess). The raw answer: webapi\repair.json.
/// Returned as CONDITION 0..1 (1 = no damage; suspension = the worst wheel) + the damage per wheel; -1 / null = not found.</summary>
public static class DamageParse
{
    public static (double Aero, double Susp) Parse(string json) { var d = ParseAll(json); return (d.Aero, d.Susp); }

    public static (double Aero, double Susp, double[] SuspWheels) ParseAll(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var r = doc.RootElement;
            if (r.ValueKind == JsonValueKind.Object && r.TryGetProperty("wearables", out var w) && w.ValueKind == JsonValueKind.Object)
            {
                double aero = w.TryGetProperty("body", out var b) && b.ValueKind == JsonValueKind.Object && b.TryGetProperty("aero", out var a) ? Frac(a) : -1;
                double[] wheels = null;
                if (w.TryGetProperty("suspension", out var s) && s.ValueKind == JsonValueKind.Array)
                {
                    var list = s.EnumerateArray().Select(Frac).ToList();
                    if (list.Count > 0 && list.All(x => x >= 0)) wheels = list.ToArray();
                }
                return (aero < 0 ? -1 : 1 - aero, wheels == null ? -1 : 1 - wheels.Max(), wheels);
            }
            double ga = -1, gs = -1;
            Walk(r, "", ref ga, ref gs);
            return (ga < 0 ? -1 : 1 - ga, gs < 0 ? -1 : 1 - gs, null);
        }
        catch (Exception) { return (-1, -1, null); }
    }

    // a damage fraction 0..1 (a percentage is turned into one), -1 = not a number / out of range
    static double Frac(JsonElement e)
    {
        if (e.ValueKind != JsonValueKind.Number) return -1;
        double v = e.GetDouble(); if (v < 0) return -1;
        if (v > 1) v /= 100;
        return v > 1 ? -1 : v;
    }

    // aero / susp = the largest damage found so far (0..1), -1 = none yet
    static void Walk(JsonElement e, string path, ref double aero, ref double susp)
    {
        switch (e.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var p in e.EnumerateObject()) Walk(p.Value, path + "/" + p.Name, ref aero, ref susp);
                break;
            case JsonValueKind.Array:
                foreach (var x in e.EnumerateArray()) Walk(x, path, ref aero, ref susp);
                break;
            case JsonValueKind.Number:
                string k = path.ToLowerInvariant();
                if (!k.Contains("damage") && !k.Contains("dmg")) return;
                double v = Frac(e); if (v < 0) return;
                if (k.Contains("aero")) aero = Math.Max(aero, v);
                else if (k.Contains("susp")) susp = Math.Max(susp, v);
                break;
        }
    }
}
