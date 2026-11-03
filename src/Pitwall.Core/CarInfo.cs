namespace Pitwall.Core;

/// <summary>Per-lap use of one quantity (fuel litres or virtual energy %) of the focus car. A lap counts when the lap counter moves on and the car was not in the pit
/// lane during it; the first (partial) lap after the car is first seen is not counted, nor a refill. Same rules as the SimHub dashboard's tracker, minus its partial first lap.</summary>
public sealed class UsageTracker
{
    readonly double max;                 // a lap using more than this is a glitch (fuel 40 L, VE 50 %)
    string key; int lap; double v0, bv, bp; bool pit, partial;
    readonly List<double> laps = new();
    public double Live { get; private set; } = -1;

    public UsageTracker(double max) { this.max = max; Reset(null); }

    void Reset(string k) { key = k; lap = int.MinValue; v0 = -1; bv = -1; bp = 0; pit = false; partial = true; laps.Clear(); Live = -1; }

    /// <param name="key">car + session: a new key starts over</param><param name="lapFrac">0..1 round the lap</param>
    public void Update(string key, int completedLaps, double value, bool inPit, double lapFrac)
    {
        if (key != this.key) Reset(key);
        if (inPit) { pit = true; bv = -1; }
        if (completedLaps != lap)
        {
            if (!partial && !pit && v0 > 0 && value > 0)
            {
                double u = v0 - value;
                if (u > 0 && u < max) { laps.Add(u); if (laps.Count > 20) laps.RemoveAt(0); }
            }
            partial = lap == int.MinValue;          // the lap the car was first seen in is not complete
            lap = completedLaps; v0 = value; pit = inPit; bv = inPit || !(value > 0) ? -1 : value; bp = 0;
        }
        else if (!inPit && bv <= 0 && value > 0) { bv = value; bp = lapFrac; }
        if (bv > 0 && !inPit && value > 0 && lapFrac - bp > 0.12)
        {
            double r = (bv - value) / (lapFrac - bp);
            if (r > 0 && r < max) Live = r;
        }
    }

    public double Avg => laps.Count == 0 ? -1 : laps.Skip(Math.Max(0, laps.Count - 5)).Average();
    public double Last => laps.Count == 0 ? -1 : laps[^1];
}

/// <summary>Builds the CarView of the focus car.</summary>
public static class CarInfo
{
    public static CarView Build(CarSnap c, SessionSnap s, double lapsLeft, UsageTracker fuel, UsageTracker ve)
    {
        if (c?.Detail == null) return new CarView();
        var d = c.Detail;
        string key = c.Slot + "|" + s.SessionId;
        double frac = s.TrackLength > 0 ? Math.Clamp(c.LapDist / s.TrackLength, 0, 1) : 0;
        fuel.Update(key, c.Laps, d.Fuel, c.InPits, frac);
        ve.Update(key, c.Laps, c.Ve, c.InPits, frac);
        int dents = d.Dents.Sum();
        return new CarView
        {
            Has = true, Driver = c.Driver, Model = c.Model, Entry = c.Entry, InPits = c.InPits || c.InGarage,
            BrakeBias = d.RearBias >= 0 && d.RearBias <= 1 ? (1 - d.RearBias) * 100 : -1,
            Tc = d.Tc, TcSlip = d.TcSlip, TcCut = d.TcCut, Abs = d.Abs, Map = d.Map, Compound = d.Compound,
            Wheels = d.Wheels, Dents = d.Dents, Detached = d.Detached, Body = Math.Max(0, 1 - dents / 16.0), LapsLeft = lapsLeft,
            Engine = d.Overheating ? "overheat" : (d.Rpm >= 0 && d.Rpm < 300 && !c.InPits && !c.InGarage && c.LapTime >= 0 ? "off" : ""),
            Fuel = Usage(fuel, d.Fuel, d.FuelCap > 0 && d.Fuel >= 0 ? d.Fuel / d.FuelCap * 100 : -1, lapsLeft),
            Ve = Usage(ve, c.Ve, c.Ve, lapsLeft),
        };
    }

    static UsageView Usage(UsageTracker t, double now, double pct, double lapsLeft)
    {
        var u = new UsageView { Now = now, Pct = pct, Avg = t.Avg, Last = t.Last, Live = t.Live };
        double a = u.Avg > 0 ? u.Avg : u.Live;
        if (a > 0 && now > 0) u.Laps = now / a;
        if (a > 0 && now >= 0 && lapsLeft > 0) { double add = Math.Ceiling(lapsLeft) * a - now; if (add > 0) u.Add = add; }
        return u;
    }
}
