namespace Pitwall.Core;

/// <summary>One car in the prediction (the focus car's class), in PREDICTED finishing order.</summary>
public sealed class PredRow
{
    public int PredPos { get; set; }                 // predicted class position at the finish
    public int ClassPos { get; set; }                // class position now
    public string Driver { get; set; } = "";
    public bool Me { get; set; }
    public bool Pit { get; set; }                    // in the pits now
    public int Stops { get; set; } = -1;             // stops still needed, -1 = not known (no use per lap yet)
    public double Gap { get; set; }                  // predicted gap to the focus car at the finish: + = ahead; seconds (Laps = 0) ...
    public int Laps { get; set; }                    // ... or whole laps (+ ahead / - behind) when a lap or more apart
    public double Pace { get; set; } = -1;           // the race pace used (s per lap)
    public bool Sure { get; set; }                   // enough laps seen (pace from at least 3 clean laps, use per lap known)
}

/// <summary>Prediction widget: where the class finishes if everybody keeps their pace and makes the stops their energy needs. Numbers only.</summary>
public sealed class PredictionView
{
    public bool Has { get; set; }
    public string Why { get; set; } = "";            // why not: "race" (not a race) | "length" (race length unknown) | "car" (no focus car) | "" = fine
    public double Remaining { get; set; } = -1;      // seconds left (timed race) ...
    public int LapsLeft { get; set; } = -1;          // ... or laps left (lap race, for the leader)
    public double PitLoss { get; set; }              // seconds a stop costs (learned from this race's stops, else the default)
    public bool PitLossLearned { get; set; }
    public int MyPos { get; set; }                   // focus car: class position now ...
    public int MyPred { get; set; }                  // ... and predicted
    public int MyStops { get; set; } = -1;
    public List<PredRow> Rows { get; set; } = new();
}

/// <summary>Follows every car lap by lap (race pace from its clean laps, VE % or fuel used per lap, the most energy seen = its tank, the time its pit
/// stops cost) and predicts the finishing order: for each car the stops it still needs before the end (energy left vs. laps left), then how far it gets in the
/// time left minus those stops (a lap race: when it finishes). Accidents, safety cars and strategy changes cannot be known.</summary>
public sealed class PredictionTracker
{
    public const double DefaultPitLoss = 50;
    sealed class Car
    {
        public int Laps = -1; public double Energy = -1, Max = -1, CrossEt = -1; public bool PitThisLap, InPitRun; public double PitRunTime; public int PitRunLaps;
        public readonly List<double> Times = new(), Use = new();
    }
    readonly Dictionary<int, Car> cars = new();
    readonly List<double> losses = new();
    int session = -1;

    static double Energy(CarSnap c) => c.Ve > 0 ? c.Ve : (c.Detail?.Fuel ?? -1);                    // VE % (Hypercar, GT3), else fuel litres
    static double Median(IEnumerable<double> v) { var s = v.OrderBy(x => x).ToList(); return s.Count == 0 ? -1 : s.Count % 2 == 1 ? s[s.Count / 2] : (s[s.Count / 2 - 1] + s[s.Count / 2]) / 2; }
    // race pace: the average of the last 8 laps within 7 % of the car's best (traffic, mistakes and slow laps out). Lap 1 is never in Times: the start costs
    // 7-20 s and differs per grid spot (owner, Monza 15 min: it made a car that lost time at the start look ~2 s/lap slower for the whole race).
    static double Pace(Car k)
    {
        if (k.Times.Count == 0) return -1;
        double b = k.Times.Min(); var c = k.Times.Where(t => t < b * 1.07).ToList();
        return c.Skip(Math.Max(0, c.Count - 8)).Average();
    }

    /// <summary>Learns from this reading (call every reading, all cars).</summary>
    public void Learn(RaceSnapshot snap)
    {
        if (snap.Session.SessionId != session) { cars.Clear(); losses.Clear(); session = snap.Session.SessionId; }
        foreach (var c in snap.Cars)
        {
            if (!cars.TryGetValue(c.Slot, out var k)) { cars[c.Slot] = k = new Car { Laps = c.Laps, Energy = Energy(c) }; }
            double e = Energy(c);
            if (e > k.Max) k.Max = e;
            if (c.InPits) k.PitThisLap = true;
            if (c.Laps <= k.Laps) continue;
            // a lap completed. Its time = the clock between two crossings of the line (as the relative measures), NOT the game's lap time: a cut lap has no
            // time, the out-lap has none, and the lap time can change a reading after the counter. -1 = not known (the first crossing seen: the start lap,
            // or a car first seen mid-lap / mid-race).
            double lapTime = k.CrossEt >= 0 && c.Laps - k.Laps == 1 ? snap.Session.Et - k.CrossEt : -1;
            k.CrossEt = snap.Session.Et;
            double pace = Pace(k);
            if (k.PitThisLap) { k.InPitRun = true; if (lapTime > 0) k.PitRunTime += lapTime; else k.PitRunTime = double.NaN; k.PitRunLaps++; }   // NaN: a lap of the stop not timed: no sample
            else
            {
                if (k.InPitRun)                                                                   // the stop is over: in-lap(s) + out-lap + this lap minus normal laps
                {
                    if (pace > 0 && lapTime > 0 && !double.IsNaN(k.PitRunTime)) { double loss = k.PitRunTime + lapTime - (k.PitRunLaps + 1) * pace; if (loss is > 5 and < 400) losses.Add(loss); }
                    k.InPitRun = false; k.PitRunTime = 0; k.PitRunLaps = 0;
                }
                else if (lapTime > 0 && c.Laps > 1) { k.Times.Add(lapTime); if (k.Times.Count > 20) k.Times.RemoveAt(0); }   // Pace() leaves the slow ones out
                if (k.Energy > 0 && e >= 0 && k.Energy - e > 0 && c.Laps - k.Laps == 1) { k.Use.Add(k.Energy - e); if (k.Use.Count > 6) k.Use.RemoveAt(0); }
            }
            k.Laps = c.Laps; k.Energy = e; k.PitThisLap = c.InPits;
        }
    }

    public double PitLoss => losses.Count > 0 ? Median(losses) : DefaultPitLoss;

    /// <summary>The prediction for the focus car's class. pitLoss &gt; 0 = use that instead of the learned one.</summary>
    public PredictionView Build(RaceSnapshot snap, CarSnap focus, double pitLoss = -1)
    {
        var s = snap.Session; var v = new PredictionView { PitLoss = pitLoss > 0 ? pitLoss : PitLoss, PitLossLearned = pitLoss <= 0 && losses.Count > 0 };
        if (s.SessionId < 10 || s.SessionId > 13) { v.Why = "race"; return v; }
        if (focus == null) { v.Why = "car"; return v; }
        double L = s.TrackLength, R = s.EndEt > 0 && s.MaxLaps <= 0 ? s.EndEt - s.Et : -1;
        if (R < 0 && s.MaxLaps <= 0) { v.Why = "length"; return v; }
        var cls = snap.Cars.Where(c => c.Cls == focus.Cls).OrderBy(c => c.Place).ToList();
        double classPace = Median(cls.Select(c => cars.TryGetValue(c.Slot, out var k) ? Pace(k) : -1).Where(p => p > 0));
        double classUse = Median(cls.Select(c => cars.TryGetValue(c.Slot, out var k) && k.Use.Count > 0 ? k.Use.Average() : -1).Where(u => u > 0));
        double loss = v.PitLoss;
        var est = new List<(CarSnap C, int Pos, double Score, int Stops, double Pace, bool Sure)>();
        int pos = 0;
        foreach (var c in cls)
        {
            pos++;
            cars.TryGetValue(c.Slot, out var k);
            double p = k != null ? Pace(k) : -1; bool sure = k != null && k.Times.Count >= 3 && k.Use.Count > 0;
            if (p <= 0) p = c.Best > 0 ? c.Best * 1.02 : classPace;
            double prog = c.Laps + (L > 0 ? Math.Clamp(c.LapDist / L, 0, 1) : 0);
            if (p <= 0) { est.Add((c, pos, R >= 0 ? prog : -1e9, -1, -1, false)); continue; }
            double use = k != null && k.Use.Count > 0 ? k.Use.Average() : classUse, now = Energy(c), cap = k != null && k.Max > 0 ? k.Max : (c.Ve > 0 ? 100 : c.Detail?.FuelCap ?? -1);
            double extra = 0;
            if (c.InPits) { now = cap; extra = loss / 2; }                                        // stopping now: it leaves full; half the stop still to go
            int Stops(double laps) => use > 0 && now >= 0 && cap > 0 ? (int)Math.Max(0, Math.Ceiling((laps * use - now) / (cap * 0.98))) : -1;
            int stops; double score;
            if (R >= 0)                                                                            // timed: distance covered by the end
            {
                if (c.InGarage) { est.Add((c, pos, prog, 0, p, sure)); continue; }               // out of the race: stays where it is
                double laps = R / p; stops = Stops(laps);
                laps = Math.Max(0, (R - Math.Max(0, stops) * loss - extra) / p); stops = Stops(laps);
                laps = Math.Max(0, (R - Math.Max(0, stops) * loss - extra) / p);
                score = prog + laps;
            }
            else                                                                                   // lap race: the time it needs to finish (lower = ahead)
            {
                double left = Math.Max(0, s.MaxLaps - prog); stops = Stops(left);
                score = c.InGarage ? -1e9 : -(left * p + Math.Max(0, stops) * loss + extra);
            }
            est.Add((c, pos, score, stops, p, sure));
        }
        var order = est.OrderByDescending(x => x.Score).ToList();
        var me = order.FirstOrDefault(x => x.C == focus);
        if (me.C == null) { v.Why = "car"; return v; }
        double myPace = me.Pace > 0 ? me.Pace : classPace;
        for (int i = 0; i < order.Count; i++)
        {
            var x = order[i]; var row = new PredRow { PredPos = i + 1, ClassPos = x.Pos, Driver = x.C.Driver, Me = x.C == focus, Pit = x.C.InPits || x.C.InGarage, Stops = x.Stops, Pace = x.Pace > 0 ? Math.Round(x.Pace, 3) : -1, Sure = x.Sure };
            if (!row.Me)
            {
                double d = x.Score - me.Score;                                                     // timed: laps of distance; lap race: seconds (already negative = behind)
                double secs = R >= 0 ? d * myPace : d;
                double lapsApart = R >= 0 ? d : (myPace > 0 ? d / myPace : 0);
                if (Math.Abs(lapsApart) >= 1) row.Laps = (int)Math.Truncate(lapsApart); else row.Gap = Math.Round(secs, 1);
            }
            v.Rows.Add(row);
        }
        v.Has = true; v.MyPos = me.Pos; v.MyPred = order.IndexOf(me) + 1; v.MyStops = me.Stops;
        v.Remaining = R >= 0 ? Math.Round(R) : -1;
        v.LapsLeft = R < 0 && cls.Count > 0 ? Math.Max(0, s.MaxLaps - cls[0].Laps) : -1;
        return v;
    }
}
