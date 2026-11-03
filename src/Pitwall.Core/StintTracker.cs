namespace Pitwall.Core;

/// <summary>One stint of the followed car as it really happened. Times are session times (mCurrentET); the page turns them into race time.</summary>
public sealed class LiveStint
{
    public string Driver { get; set; } = "";
    public int StartLap { get; set; }             // the car's completed laps when the stint began
    public int Laps { get; set; }                 // laps completed in this stint (kept up to date while it runs)
    public double Start { get; set; }             // green flag / pit exit
    public double End { get; set; } = -1;         // pit entry, -1 = still running
    public bool? NewTyres { get; set; }           // tyres fresher than at the pit entry before it; null = not known
    public double VeStart { get; set; } = -1;
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
    public List<LiveStint> Stints { get; set; } = new();
}

/// <summary>Watches the followed car through a race: green flag, pit entry / exit (= the stints), laps per stint, driver, new tyres (wear went up during the stop).
/// Fed every reading by DataPump (also when no page is open). Numbers only; the strategy page plans with them.</summary>
public sealed class StintTracker
{
    public RaceLog Log { get; private set; }
    /// <summary>Something worth saving happened (a new race, the green flag, a pit entry or exit).</summary>
    public bool Changed { get; set; }

    public StintTracker(RaceLog saved = null) { Log = saved; }

    public void Update(RaceSnapshot snap, CarSnap focus, long clockMs)
    {
        if (snap == null) return;
        var ses = snap.Session;
        if (ses.SessionId < 10 || ses.SessionId > 13) return;                                         // races only (10-13); an old log stays until the next race
        if (Log == null || Log.Track != ses.TrackName || Math.Abs(Log.EndEt - ses.EndEt) > 1 || ses.Et < Log.LastEt - 30)
        {
            Log = new RaceLog { Track = ses.TrackName, EndEt = ses.EndEt };
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
            if (inPit && !Log.InPit) { cur.End = ses.Et; Log.WearAtEntry = wear; Changed = true; }   // pit entry: the stint is over
        }
        else if (!inPit && Log.InPit)
        {
            bool? fresh = wear >= 0 && Log.WearAtEntry >= 0 ? wear > Log.WearAtEntry + 0.02 : null;  // pit exit: a new stint
            Log.Stints.Add(new LiveStint { Driver = car.Driver, StartLap = car.Laps, Start = ses.Et, NewTyres = fresh, VeStart = car.Ve });
            Changed = true;
        }
        Log.InPit = inPit;
    }

    static double Wear(CarSnap c)
    {
        var w = c.Detail?.Wheels;
        if (w == null || w.Length < 4 || w.Any(x => x.Wear < 0)) return -1;
        return w.Average(x => x.Wear);
    }
}
