namespace MyLMUHub.Core;

/// <summary>One stint of the followed car as it really happened. Times are session times (mCurrentET); the page turns them into race time.</summary>
public sealed class LiveStint
{
    public string Driver { get; set; } = "";
    public int StartLap { get; set; }             // the car's completed laps when the stint began
    public int Laps { get; set; }                 // laps completed in this stint (kept up to date while it runs; the in-lap counts: finished in the pit lane)
    public double Start { get; set; }             // green flag / pit exit
    public double End { get; set; } = -1;         // pit entry, -1 = still running
    public bool? NewTyres { get; set; }           // tyres fresher than at the pit entry before it; null = not known
    public string TyresChanged { get; set; }      // which: "FL FR RL RR" (all), "FL FR" (fronts) ...; null = not known, "" = none
    public double VeStart { get; set; } = -1;
    /// <summary>Each lap of the stint as the line is crossed: [the car's lap count, lap time s (-1 = none), VE % at the line, 1 = in / out lap (in the pit lane
    /// during it)]. For the Live tab: this stint's average and fastest lap, its VE use per lap (owner 2026-11-14: per stint, not one number for the race).</summary>
    public List<double[]> LapLog { get; set; } = new();
}

/// <summary>The race so far of the followed car (saved by the app, so a restart during a 24 h race keeps it).</summary>
public sealed class RaceLog
{
    public string Track { get; set; } = "";
    public double EndEt { get; set; }             // the session's end time: tells one race session from another
    public int Slot { get; set; } = -1;           // the car (scoring slot: stays the same through driver swaps)
    public string Entry { get; set; } = "";
    public double GreenEt { get; set; } = -1;     // session time of the green flag, -1 = not seen (the app started during the race)
    public long GreenClock { get; set; }          // the same moment on the PC's clock (unix ms), 0 = not seen
    public bool MissedStart { get; set; }         // the app was not watching at the start: stints before it are not known
    public double LastEt { get; set; } = -1;
    public bool InPit { get; set; }
    public double WearAtEntry { get; set; } = -1; // average tyre left (0..1) when the car came in
    public double[] WheelsAtEntry { get; set; }   // tyre left per wheel (FL FR RL RR) when the car came in, null = not known
    public int LastLaps { get; set; } = -1;       // the car's lap count at the last reading (a new lap = it went up)
    public bool LapPit { get; set; }              // the car was in the pit lane during the lap now being driven
    public List<LiveStint> Stints { get; set; } = new();
    public double SpeedPoint { get; set; } = -1;  // metres round the lap where each lap's speed is taken (learned on the longest straight), -1 = not yet
}

/// <summary>Watches the followed car through a race: green flag, pit entry / exit (= the stints), laps per stint, driver, new tyres (wear went up during the stop).
/// Fed every reading by DataPump (also when no page is open). Numbers only; the strategy page plans with them.</summary>
public sealed class StintTracker
{
    public RaceLog Log { get; private set; }
    /// <summary>Something worth saving happened (a new race, the green flag, a pit entry or exit).</summary>
    public bool Changed { get; set; }

    public StintTracker(RaceLog saved = null) { Log = saved; }

    // ---- top speed per lap (owner 2026-11-16: aero damage while spectating is not shown by the game; a lower top speed shows it). Each lap: the speed at
    // SpeedPoint (on the approach to the fastest point of the lap, where the car is still flat out: lifting before the braking point does not change it) and
    // the lap's highest speed, in km/h, at the end of its LapLog row. SpeedPoint is learned from the first 3 clean laps: the fastest point of their median
    // speed trace, then back along the straight to where the speed is 93 % of it. Between two readings the speed is drawn as a straight line (the pump reads
    // 10 times a second, once a second when no dashboard is open).
    const double Bin = 10;                                                                            // metres per step of the learned speed trace
    float[] prof; readonly List<float[]> profs = new(); double prevDist = -1, prevV = -1, lapAt = -1, lapMax = -1;
    void Speed(CarSnap car, double len, bool inPit)
    {
        if (!(len > 100) || car.Speed < 0 || car.LapDist < 0 || inPit) { prevDist = -1; return; }
        int nb = (int)Math.Ceiling(len / Bin); if (prof == null || prof.Length != nb) prof = new float[nb];
        double d = car.LapDist, v = car.Speed * 3.6;
        if (v > lapMax) lapMax = v;
        if (prevDist >= 0 && d > prevDist && d - prevDist < 400)
        {
            for (int b = (int)(prevDist / Bin); b <= Math.Min(nb - 1, (int)(d / Bin)); b++)
            { double x = Math.Clamp(((b + 0.5) * Bin - prevDist) / (d - prevDist), 0, 1), vb = prevV + (v - prevV) * x; if (vb > prof[b]) prof[b] = (float)vb; }
            double sp = Log.SpeedPoint; if (sp >= 0 && prevDist < sp && sp <= d) lapAt = prevV + (v - prevV) * (sp - prevDist) / (d - prevDist);
        }
        prevDist = d; prevV = v;
    }
    // the line: this lap's two speeds; a clean lap's trace helps learn the point
    (double At, double Max) EndLap(bool clean)
    {
        var r = (At: lapAt > 0 ? Math.Round(lapAt, 1) : -1, Max: lapMax > 0 ? Math.Round(lapMax, 1) : -1);
        if (clean && prof != null && Log.SpeedPoint < 0 && prof.Count(x => x > 0) > prof.Length * 0.8) { profs.Add(prof); if (profs.Count >= 3) Learn(); }
        prof = prof == null ? null : new float[prof.Length]; lapAt = -1; lapMax = -1; prevDist = -1;
        return r;
    }
    void Learn()
    {
        int nb = profs[0].Length; var med = new double[nb];
        for (int b = 0; b < nb; b++) { var xs = profs.Where(p => p.Length == nb && p[b] > 0).Select(p => (double)p[b]).OrderBy(x => x).ToList(); med[b] = xs.Count == 0 ? 0 : xs[xs.Count / 2]; }
        int pk = Array.IndexOf(med, med.Max()); double top = med[pk];
        int c = pk; for (int i = 0; i < nb && med[(c - 1 + nb) % nb] >= 0.93 * top && med[(c - 1 + nb) % nb] > 0; i++) c = (c - 1 + nb) % nb;
        Log.SpeedPoint = (c + 0.5) * Bin; Changed = true; profs.Clear();
    }

    public void Update(RaceSnapshot snap, CarSnap focus, long clockMs)
    {
        if (snap == null) return;
        var ses = snap.Session;
        if (ses.SessionId < 10 || ses.SessionId > 13) return;                                         // races only (10-13); an old log stays until the next race
        if (Log == null || Log.Track != ses.TrackName || Math.Abs(Log.EndEt - ses.EndEt) > 1 || ses.Et < Log.LastEt - 30)
        {
            Log = new RaceLog { Track = ses.TrackName, EndEt = ses.EndEt }; profs.Clear(); prof = null; prevDist = -1; lapAt = -1; lapMax = -1;
            if (ses.GamePhase >= 5 && ses.GamePhase != 9 && ses.Et > 30) Log.MissedStart = true;     // joined (or the app started) after the start
            Changed = true;
        }
        Log.LastEt = ses.Et;
        if (Log.GreenEt < 0 && !Log.MissedStart && ses.GamePhase == 5) { Log.GreenEt = ses.Et; Log.GreenClock = clockMs; Changed = true; }
        if (Log.GreenEt < 0 && !Log.MissedStart) return;                                             // still before the green flag

        var car = Log.Slot >= 0 ? snap.Cars.FirstOrDefault(c => c.Slot == Log.Slot) : null;
        if (car == null && focus != null) { car = focus; Log.Slot = focus.Slot; Log.Entry = focus.Entry; Changed = true; }
        if (car == null) return;
        bool inPit = car.InPits || car.InGarage;
        double wear = Wear(car);
        var cur = Log.Stints.Count > 0 ? Log.Stints[^1] : null;
        if (inPit) Log.LapPit = true;
        if (Log.LastLaps >= 0 && car.Laps > Log.LastLaps)                                             // the line: one lap more (the in-lap ends in the pit lane)
        {
            var (vAt, vMax) = EndLap(!Log.LapPit && car.Laps == Log.LastLaps + 1);
            if (cur != null) { cur.LapLog.Add(new[] { car.Laps, car.Last > 0 ? Math.Round(car.Last, 3) : -1, car.Ve >= 0 ? Math.Round(car.Ve, 3) : -1, Log.LapPit ? 1 : 0, vAt, vMax }); Changed = true; }
            Log.LapPit = inPit;
        }
        Log.LastLaps = car.Laps;
        Speed(car, ses.TrackLength, inPit);

        if (cur == null)
        {
            // the first stint: from the green flag (or from now, when the start was missed); a car still in the pit lane starts when it leaves
            if (!inPit) { Log.Stints.Add(new LiveStint { Driver = car.Driver, StartLap = car.Laps, Start = Log.GreenEt >= 0 ? Log.GreenEt : ses.Et, NewTyres = Log.GreenEt >= 0 ? true : null, VeStart = car.Ve }); Changed = true; }
            Log.InPit = inPit;
            return;
        }
        if (cur.End < 0)
        {
            cur.Laps = Math.Max(0, car.Laps - cur.StartLap);
            if (car.Driver.Length > 0 && cur.Laps == 0) cur.Driver = car.Driver;                     // the name can follow a moment after a swap
            if (inPit && !Log.InPit) { cur.End = ses.Et; Log.WearAtEntry = wear; Log.WheelsAtEntry = Wheels(car); Changed = true; }   // pit entry: the stint is over
        }
        else if (!inPit && Log.InPit)
        {
            cur.Laps = Math.Max(cur.Laps, car.Laps - cur.StartLap);                                  // the in-lap: the line is in the pit lane (owner: 26 laps, not 25)
            bool? fresh = wear >= 0 && Log.WearAtEntry >= 0 ? wear > Log.WearAtEntry + 0.02 : null;  // pit exit: a new stint
            Log.Stints.Add(new LiveStint { Driver = car.Driver, StartLap = car.Laps, Start = ses.Et, NewTyres = fresh, TyresChanged = Changed4(Log.WheelsAtEntry, Wheels(car)), VeStart = car.Ve });
            Changed = true;
        }
        else if (inPit && cur.End >= 0) cur.Laps = Math.Max(cur.Laps, car.Laps - cur.StartLap);
        Log.InPit = inPit;
    }

    static double[] Wheels(CarSnap c)
    {
        var w = c.Detail?.Wheels;
        return w == null || w.Length < 4 || w.Any(x => x.Wear < 0) ? null : w.Select(x => x.Wear).ToArray();
    }

    // which tyres are fresher after the stop than at the pit entry (e.g. only the fronts), null = not known
    static string Changed4(double[] before, double[] after)
    {
        if (before == null || after == null) return null;
        string[] n = { "FL", "FR", "RL", "RR" };
        return string.Join(" ", Enumerable.Range(0, 4).Where(i => after[i] > before[i] + 0.02).Select(i => n[i]));
    }

    static double Wear(CarSnap c)
    {
        var w = c.Detail?.Wheels;
        if (w == null || w.Length < 4 || w.Any(x => x.Wear < 0)) return -1;
        return w.Average(x => x.Wear);
    }
}
