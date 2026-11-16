using System.Text.Json;

namespace MyLMUHub.Core;

/// <summary>Aero and suspension damage from the game's web API (GET rest/garage/UIScreen/RepairAndRefuel, the repair screen of YOUR car).
/// Shape as TinyPedal reads it (lmu_restapi.py): wearables.body.aero = aero damage, wearables.suspension = damage per wheel (FL FR RL RR), as fractions
/// (0 = none, 1 = totaled). Without "wearables": any number whose name says aero / suspension + damage (older guess). The raw answer: webapi\repair.json.
/// Returned as CONDITION 0..1 (1 = no damage; suspension = the worst wheel) + the damage per wheel; -1 / null = not found.</summary>
public sealed class RepairCar
{
    public string Vehicle = "";
    public double Aero = -1, Susp = -1; public double[] SuspWheels;
    public double[] Wear;                                                  // tyre left 0..1 FL FR RL RR, null = none
    public double[] Pressure = { -1, -1, -1, -1 }, TyreTempK = { -1, -1, -1, -1 }, BrakeTempK = { -1, -1, -1, -1 };
    // repair times of this race (pitStopTimes.times, s): FixAeroDamage / FixAllDamage, FixRandomDelay (up to), FixTimeConcurrent (1 = done while the rest
    // of the stop goes on, 0 = added to it); -1 = not known. Seen 2026-11-15 (Bahrain 8 h): 30 / 30 / 5 / 0
    public double FixAero = -1, FixAll = -1, FixRandom = -1, FixConcurrent = -1;

    /// <summary>Is this the car you watch? The game's entry name of the focus car = vehicleName here.</summary>
    public bool Is(CarSnap c) => c != null && Vehicle.Length > 0 && string.Equals(Base(Vehicle), Base(c.Entry), StringComparison.OrdinalIgnoreCase);
    static string Base(string n) { n = (n ?? "").Trim(); int i = n.LastIndexOf(':'); return i > 0 && n.LastIndexOf('#') < i ? n[..i].Trim() : n; }   // "Team 2026 #61:LM" = "Team 2026 #61"

    /// <summary>Fills the wheels the game sends no data for (a team-mate drives: SnapshotReader set them to -1) from the repair screen.</summary>
    public void FillWheels(WheelSnap[] wheels)
    {
        if (wheels == null || wheels.Length != 4) return;
        for (int i = 0; i < 4; i++)
        {
            var w = wheels[i]; if (w.Pressure > 0 || w.Temp != null) continue;    // the game's own numbers win
            if (Wear != null) w.Wear = Wear[i];
            if (Pressure[i] > 0) w.Pressure = Pressure[i];
            if (TyreTempK[i] > 0) w.Temp = TyreTempK[i] - 273.15;
            if (BrakeTempK[i] > 0) w.Brake = BrakeTempK[i] - 273.15;
        }
    }
}

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

    /// <summary>The repair screen = the car of YOUR team (also while a team-mate drives it): which car (teamInfo.vehicleName, as the game's entry name), its
    /// damage, and its tyres (wearables.tires = tyre left 0..1 per wheel FL FR RL RR, wheelInfo.wheelLocs[i] tirePressure kPa / tireTemp K / brakeTemp K).
    /// Seen live 2026-11-14 while a team-mate drove: shared memory has no tyre data for that car, this does (pressure / temperatures the same on all 4 wheels).
    /// Wear read as tyre LEFT like shared memory's mWear (ASSUMED: 1.0 on every wheel after 5 laps). null = not parsable.</summary>
    public static RepairCar ParseCar(string json)
    {
        try
        {
            var (aero, susp, suspWheels) = ParseAll(json);
            using var doc = JsonDocument.Parse(json);
            var r = doc.RootElement; if (r.ValueKind != JsonValueKind.Object) return null;
            var car = new RepairCar { Aero = aero, Susp = susp, SuspWheels = suspWheels };
            if (r.TryGetProperty("teamInfo", out var ti) && ti.ValueKind == JsonValueKind.Object && ti.TryGetProperty("vehicleName", out var vn) && vn.ValueKind == JsonValueKind.String)
                car.Vehicle = vn.GetString() ?? "";
            if (r.TryGetProperty("wearables", out var w) && w.ValueKind == JsonValueKind.Object && w.TryGetProperty("tires", out var t) && t.ValueKind == JsonValueKind.Array)
            {
                var l = t.EnumerateArray().Select(Frac).ToList();
                if (l.Count == 4 && l.All(x => x >= 0)) car.Wear = l.ToArray();
            }
            if (r.TryGetProperty("wheelInfo", out var wi) && wi.ValueKind == JsonValueKind.Object && wi.TryGetProperty("wheelLocs", out var wl) && wl.ValueKind == JsonValueKind.Array && wl.GetArrayLength() == 4)
            {
                int i = 0;
                foreach (var x in wl.EnumerateArray())
                {
                    car.Pressure[i] = Num(x, "tirePressure"); car.TyreTempK[i] = Num(x, "tireTemp"); car.BrakeTempK[i] = Num(x, "brakeTemp"); i++;
                }
            }
            if (r.TryGetProperty("pitStopTimes", out var pt) && pt.ValueKind == JsonValueKind.Object && pt.TryGetProperty("times", out var tm))
            { car.FixAero = Num(tm, "FixAeroDamage"); car.FixAll = Num(tm, "FixAllDamage"); car.FixRandom = Num(tm, "FixRandomDelay"); car.FixConcurrent = Num(tm, "FixTimeConcurrent"); }
            return car;
        }
        catch (Exception) { return null; }
    }

    static double Num(JsonElement o, string k) => o.ValueKind == JsonValueKind.Object && o.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : -1;

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
