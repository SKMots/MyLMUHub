namespace MyLMUHub.Core;

/// <summary>The "best lap ever" widget: YOUR best lap on this track in this car class (any car of the class). Times in seconds, -1 = none. Numbers only (the page formats).</summary>
public sealed class PbView
{
    public bool Has { get; set; }                  // a lap of yours on this track with this car (result files or this session)
    public double Lap { get; set; } = -1;          // the best lap ever (result files and this session)
    public double S1 { get; set; } = -1;           // its sectors (own sector times), -1 = not known
    public double S2 { get; set; } = -1;
    public double S3 { get; set; } = -1;
    public long Time { get; set; }                 // when it was set (unix s); this session = now
    public string Type { get; set; } = "";         // Race / Qualify / Practice ...
    public bool New { get; set; }                  // set in this session (beat the result files)
    public double Session { get; set; } = -1;      // your best lap this session
    public double Last { get; set; } = -1;         // your last lap this session
    public string Track { get; set; } = "";        // what it looked for (shown when nothing is found)
    public string Car { get; set; } = "";          // the class it looked for
    public string SetWith { get; set; } = "";      // the car the best lap was driven in          // the class it looked for
}

/// <summary>Your best laps per track + class: from the result files (Race Pace sessions = only laps driven under your names) and the laps YOU drive live.
/// A team-mate's laps never count: the result files keep only your names' laps, and live only laps completed while one of your names is driving.
/// Track and car are matched by name, ignoring case, spaces and punctuation (one may contain the other: "BMW M4 LMGT3" / "BMW M4 LMGT3 #397").</summary>
public sealed class PersonalBest
{
    sealed class Live { public double Best = -1, S1 = -1, S2 = -1, Last = -1; public long BestAt; public readonly LapWatch Watch = new(); }
    readonly Dictionary<string, Live> live = new();
    string sessionKey = "";

    public static string Norm(string s) => new string((s ?? "").ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());
    public static bool Same(string a, string b)
    {
        string x = Norm(a), y = Norm(b);
        return x.Length > 2 && y.Length > 2 && (x == y || x.Contains(y) || y.Contains(x));
    }

    /// <summary>Tracks must match exactly (ignoring case / punctuation): the live name is the result files' TrackCourse (seen: "Bahrain Outer Circuit"),
    /// and a layout must never borrow another layout's lap.</summary>
    public static bool SameTrack(string a, string b) { string x = Norm(a); return x.Length > 2 && x == Norm(b); }
    /// <summary>Classes: the same name ignoring case / punctuation ("GT3" = "gt3", "LMP2_ELMS" = "LMP2 ELMS").</summary>
    public static bool SameClass(string a, string b) { string x = Norm(a); return x.Length > 1 && x == Norm(b); }

    /// <summary>Classes: the same name ignoring case / punctuation ("GT3" = "gt3", "LMP2_ELMS" = "LMP2 ELMS").</summary>: the lap row ([n, t, s1, s2, s3, flags, ...]) and its session; null = none.</summary>
    public static (double?[] Lap, PaceSession Session)? Find(IEnumerable<PaceSession> sessions, string track, string cls)
    {
        (double?[] Lap, PaceSession Session)? best = null;
        foreach (var s in sessions)
        {
            if (!SameTrack(s.Track, track) || !SameClass(s.Class, cls)) continue;
            foreach (var l in s.Laps)
            {
                if (l.Length < 6 || !(l[1] > 0) || ((int)(l[5] ?? 0) & 1) != 0) continue;   // no time, or a pit lap
                if (best == null || l[1] < best.Value.Lap[1]) best = (l, s);
            }
        }
        return best;
    }

    /// <summary>Follows the laps you drive now (call every reading): a lap counts when it is completed with its time (LapWatch: counter AND lap time) while
    /// one of your names drives it and it was not in the pits. Keyed by session + track + car, so a new session starts again.</summary>
    public void Update(RaceSnapshot snap, CarSnap car, ICollection<string> myNames)
    {
        if (snap == null || car == null) return;
        string key = snap.Session.SessionId + "|" + Norm(snap.Session.TrackName) + "|" + Norm(car.Cls) + "|" + car.Slot;
        if (key != sessionKey || snap.Session.Et < lastEt - 30) { live.Clear(); sessionKey = key; }
        lastEt = snap.Session.Et;
        if (!live.TryGetValue(key, out var l)) live[key] = l = new Live();
        if (l.Watch.Step(car.Laps, car.Last, car.InPits, out _, out double t, out bool pit) && !pit
            && myNames.Any(n => string.Equals(n, car.Driver, StringComparison.OrdinalIgnoreCase)))
        {
            l.Last = t;
            if (l.Best < 0 || t < l.Best) { l.Best = t; l.S1 = car.Last1; l.S2 = car.Last2; l.BestAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds(); }
        }
        current = l;
    }
    double lastEt = -1; Live current;

    /// <summary>The widget's numbers: the result files' best vs this session's best (whichever is faster is the best ever).</summary>
    public PbView View(IEnumerable<PaceSession> sessions, string track, string cls, string car = "")
    {
        var v = new PbView { Track = track ?? "", Car = cls ?? "" };
        var f = sessions == null ? null : Find(sessions, track, cls);
        if (f != null)
        {
            var l = f.Value.Lap; v.Has = true; v.Lap = l[1] ?? -1; v.S1 = l[2] ?? -1; v.S2 = l[3] ?? -1; v.S3 = l[4] ?? -1; v.Time = f.Value.Session.Time; v.Type = f.Value.Session.Type; v.SetWith = f.Value.Session.Car;
        }
        var c = current;
        if (c != null)
        {
            v.Session = c.Best; v.Last = c.Last;
            if (c.Best > 0 && (v.Lap < 0 || c.Best < v.Lap))
            {
                v.Has = true; v.New = true; v.Lap = c.Best; v.Time = c.BestAt; v.Type = "This session"; v.SetWith = car ?? "";
                // live sectors are cumulative (S1, S1 + S2): own sector times
                v.S1 = c.S1 > 0 ? c.S1 : -1; v.S2 = c.S2 > 0 && c.S1 > 0 ? c.S2 - c.S1 : -1; v.S3 = c.S2 > 0 ? c.Best - c.S2 : -1;
            }
        }
        return v;
    }
}
