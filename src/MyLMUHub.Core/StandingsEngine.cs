namespace MyLMUHub.Core;

/// <summary>Best lap / sectors of the driver who is in the player's car (LMU's own "best lap" belongs to the CAR, so a faster team-mate's lap stays in it).
/// Learned from the laps seen while running: per car AND driver; the first sighting of a car is not counted as a lap; cleared when the session changes.</summary>
public sealed class PersonalBests
{
    sealed class Pb { public double Lap, S1, S2, S3; public string Cls = ""; }
    readonly Dictionary<string, Pb> pbs = new();
    readonly Dictionary<int, double> seen = new();
    int session = int.MinValue; double et = -1;

    public PbInfo Update(IReadOnlyList<CarSnap> cars, int sessionId, double sessionEt)
    {
        if (sessionId != session || (et >= 0 && sessionEt < et - 5.0)) { pbs.Clear(); seen.Clear(); }
        session = sessionId; et = sessionEt;
        CarSnap player = null;
        foreach (var c in cars)
        {
            if (c.IsPlayer) player = c;
            if (seen.TryGetValue(c.Slot, out double prev) && c.Last > 0 && Math.Abs(c.Last - prev) > StandingsEngine.Eps)
            {
                string key = Key(c);
                if (!pbs.TryGetValue(key, out var p)) { p = new Pb(); pbs[key] = p; }
                p.Cls = c.Cls;
                if (p.Lap <= 0 || c.Last < p.Lap) p.Lap = c.Last;
                if (c.Last1 > 0 && c.Last2 > c.Last1 && c.Last > c.Last2)
                {
                    double a1 = c.Last1, a2 = c.Last2 - c.Last1, a3 = c.Last - c.Last2;
                    if (p.S1 <= 0 || a1 < p.S1) p.S1 = a1;
                    if (p.S2 <= 0 || a2 < p.S2) p.S2 = a2;
                    if (p.S3 <= 0 || a3 < p.S3) p.S3 = a3;
                }
            }
            seen[c.Slot] = c.Last;
        }
        if (player == null) return new PbInfo();
        var r = new PbInfo { Driver = player.Driver };
        if (pbs.TryGetValue(Key(player), out var q)) { r.Lap = q.Lap; r.S1 = q.S1; r.S2 = q.S2; r.S3 = q.S3; }
        return r;
    }

    /// <summary>Personal best of the driver now in this car (any car, not only the player's - for spectating). Zeros = no lap yet.</summary>
    public PbInfo Get(CarSnap c)
    {
        var r = new PbInfo { Driver = c.Driver };
        if (pbs.TryGetValue(Key(c), out var q)) { r.Lap = q.Lap; r.S1 = q.S1; r.S2 = q.S2; r.S3 = q.S3; }
        return r;
    }

    /// <summary>Best S1 / S2 / S3 of the class from the laps seen while running (0 = none).</summary>
    public double[] ClassBestSectors(string cls)
    {
        var b = new double[3];
        foreach (var p in pbs.Values)
        {
            if (p.Cls != cls) continue;
            if (p.S1 > 0 && (b[0] <= 0 || p.S1 < b[0])) b[0] = p.S1;
            if (p.S2 > 0 && (b[1] <= 0 || p.S2 < b[1])) b[1] = p.S2;
            if (p.S3 > 0 && (b[2] <= 0 || p.S3 < b[2])) b[2] = p.S3;
        }
        return b;
    }
    static string Key(CarSnap c) => c.Slot + "|" + c.Driver;
}

/// <summary>
/// The leaderboard / cards logic. Rules are written down in docs/DASHBOARD-SPEC.md; tools/standings_ref.py is an independent Python
/// implementation that produced the golden files in fixtures/golden (the C# tests compare against them).
/// </summary>
public sealed class StandingsEngine
{
    public const double Eps = 0.0005;
    public const int Rows = 13;          // rows shown
    public const int TopMode = 9;        // focus at class position 1..9: show P1..P13, otherwise P1 + a window around the focus car

    public List<string> FocusNames { get; set; } = new();
    /// <summary>Spectate picker choice (null = automatic). Your own car still wins while you drive it; if the choice is not in the session, FocusNames apply.</summary>
    public SpectateTarget Spectate { get; set; }
    /// <summary>Also send every car of the class (StandingsView.All) so a leaderboard can show its own number of cars ahead / behind.</summary>
    public bool IncludeAll { get; set; }
    /// <summary>The top bar of the last Build (sent next to the standings).</summary>
    public TopBarView Top { get; private set; } = new();
    /// <summary>The focus car's car / tyre / fuel / damage numbers and the track view of the last Build.</summary>
    public CarView Car { get; private set; } = new();
    public TrackView Track { get; private set; } = new();
    /// <summary>The relative (cars round the focus car on the road, Relative.cs).</summary>
    public List<RelCar> Rel { get; private set; } = new();
    /// <summary>The predicted finishing order of the focus car's class (Prediction.cs).</summary>
    public PredictionView Pred { get; private set; } = new();
    readonly PredictionTracker predTracker = new();

    /// <summary>The focus car of the last Build (null = none): the strategy planner follows it.</summary>

    public CarSnap FocusCar { get; private set; }
    /// <summary>The learned outline of the current track (sent to the page separately when Track.MapVersion changes).</summary>
    public TrackMap Map { get; } = new();
    readonly FlagWatch flags = new();
    readonly UsageTracker fuelUse = new(40), veUse = new(50);
    readonly PersonalBests pbTracker = new();
    readonly Dictionary<string, List<double>> hist = new();     // last laps per car+driver (5-lap average)
    readonly Dictionary<string, double> histLast = new();

    public StandingsEngine(IEnumerable<string> focusNames = null) { if (focusNames != null) FocusNames = focusNames.ToList(); }

    sealed class C
    {
        public CarSnap S; public int Overall, ClassPos; public double Prog;
    }

    public StandingsView Build(RaceSnapshot snap)
    {
        double track = snap.Session.TrackLength;
        race = snap.Session.SessionId >= 10 && snap.Session.SessionId <= 13;
        var pb = pbTracker.Update(snap.Cars, snap.Session.SessionId, snap.Session.Et);

        var cars = snap.Cars.OrderBy(c => c.Place).Select(s => new C { S = s }).ToList();           // stable sort by overall place
        var cum = new double[cars.Count];
        for (int i = 0; i < cars.Count; i++)
        {
            cars[i].Overall = i;
            cars[i].Prog = cars[i].S.Laps + (track > 0 ? cars[i].S.LapDist / track : 0.0);
            cum[i] = i == 0 ? 0.0 : cum[i - 1] + Math.Max(0.0, cars[i].S.BehindNext);
        }

        // focus car: the player's own car, else the spectate choice (driver, else their car), else the first car whose driver name contains one of the configured names
        C focus = cars.FirstOrDefault(c => c.S.IsPlayer);
        var sp = Spectate;
        if (focus == null && sp != null)
            focus = cars.FirstOrDefault(c => Same(c.S.Driver, sp.Driver)) ?? cars.FirstOrDefault(c => Same(c.S.Entry, sp.Entry));
        if (focus == null)
        {
            foreach (string name in FocusNames)
            {
                string k = (name ?? "").Trim();
                if (k.Length == 0) continue;
                focus = cars.FirstOrDefault(c => c.S.Driver.IndexOf(k, StringComparison.OrdinalIgnoreCase) >= 0);
                if (focus != null) break;
            }
        }

        string cls = focus != null ? focus.S.Cls : (cars.Count > 0 ? cars[0].S.Cls : "");
        var cl = cars.Where(c => c.S.Cls == cls).ToList();
        for (int i = 0; i < cl.Count; i++) cl[i].ClassPos = i + 1;
        int N = cl.Count;
        int m = (focus != null && focus.S.Cls == cls) ? focus.ClassPos : 0;
        double best = 0;
        foreach (var c in cl) if (c.S.Best > 0 && (best == 0 || c.S.Best < best)) best = c.S.Best;

        foreach (var c in cl)                                                                         // lap history for the 5-lap average
        {
            string key = HKey(c.S);
            if (!hist.TryGetValue(key, out var laps)) { laps = new List<double>(); hist[key] = laps; histLast[key] = 0; }
            if (c.S.Last > 0 && Math.Abs(c.S.Last - histLast[key]) > Eps)
            {
                histLast[key] = c.S.Last; laps.Add(c.S.Last);
                if (laps.Count > 30) laps.RemoveAt(0);
            }
        }

        List<C> shown; bool sep = false;
        if (N <= Rows || m <= TopMode) shown = cl.Take(Rows).ToList();
        else
        {
            int st = Math.Max(2, m - 6);
            st = Math.Min(st, N - Rows + 2);
            shown = new List<C> { cl[0] };
            shown.AddRange(cl.Skip(st - 1).Take(Rows - 1));
            sep = st > 2;
        }

        bool driving = focus != null && focus.S.IsPlayer;
        var view = new StandingsView
        {
            Class = cls, Count = N, FocusPos = m, FocusDriver = focus?.S.Driver ?? "", Driving = driving, Sep = sep, ClassBest = best, Pb = pb,
            Remaining = (snap.Session.EndEt > 0 && snap.Session.EndEt >= snap.Session.Et) ? snap.Session.EndEt - snap.Session.Et : -1,
        };
        foreach (var c in shown) view.Rows.Add(Row(c, focus, driving, best, pb, cum, track));
        if (IncludeAll) view.All = cl.Select(c => Row(c, focus, driving, best, pb, cum, track)).ToList();
        if (focus != null && m > 1) view.Ahead = Card(cl[m - 2], focus, cum);
        if (focus != null && m > 0 && m < N) view.Behind = Card(cl[m], focus, cum);
        double prev = -1;                                                                             // the focus car's lap before its last one (lap history)
        if (focus != null && hist.TryGetValue(HKey(focus.S), out var fl) && fl.Count >= 2) prev = fl[^2];
        Top = TopBar.Build(snap.Session, focus?.S, m, best, pbTracker, prev); FocusCar = focus?.S;
        Map.Learn(snap);
        Car = CarInfo.Build(focus?.S, snap.Session, Top.LapsLeft, fuelUse, veUse);
        // every class: its positions (the map shows all cars in their class colour; a leaderboard can show another class)
        var groups = cars.GroupBy(c => c.S.Cls).ToList();
        foreach (var g in groups) { int p = 0; foreach (var c in g) c.ClassPos = ++p; }
        if (IncludeAll)
        {
            view.Others = new List<ClassBoard>();
            foreach (var g in groups.Where(g => g.Key != cls))
            {
                var list = g.ToList(); var lead = list[0]; double b = 0;
                foreach (var c in list) if (c.S.Best > 0 && (b == 0 || c.S.Best < b)) b = c.S.Best;
                view.Others.Add(new ClassBoard { Class = g.Key, Count = list.Count, ClassBest = b,
                    Rows = list.Select(c => { var r = Row(c, null, false, b, pb, cum, track); if (c != lead) r.Gap = Gap(c, lead, cum, track); return r; }).ToList() });   // gap: to the class leader
            }
        }
        Track = TrackInfo.Build(snap, cars.Select(c => (c.S, c.ClassPos)), focus?.S, Map);
        flags.Learn(snap); Track.Flags = flags.Build(snap, focus?.S);
        Rel = Relative.Build(snap.Session, cars.Select(c => (c.S, c.ClassPos)), focus?.S, best);
        predTracker.Learn(snap); Pred = predTracker.Build(snap, focus?.S);
        return view;
    }

    static string HKey(CarSnap s) => s.Slot + "|" + s.Driver;
    static bool Same(string a, string b) => !string.IsNullOrWhiteSpace(b) && string.Equals((a ?? "").Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);

    StandingRow Row(C c, C focus, bool driving, double best, PbInfo pb, double[] cum, double track)
    {
        var s = c.S;
        var (s1, s2, s3) = Sectors(s);
        bool isMe = c == focus;
        double b = s.Best > 0 ? s.Best : -1;
        if (driving && isMe) b = pb.Lap > 0 ? pb.Lap : -1;              // the player's own row shows the personal best of the driver in the car
        int bf = (b > 0 && best > 0 && b <= best + Eps) ? 1 : 0;
        double l = s.Last > 0 ? s.Last : -1;
        int lf;
        if (l > 0 && best > 0 && l <= best + Eps) lf = 1;
        else if (driving && isMe) lf = (l > 0 && pb.Lap > 0 && l <= pb.Lap + Eps) ? 2 : 0;
        else lf = (l > 0 && s.Best > 0 && l <= s.Best + Eps) ? 2 : 0;

        var row = new StandingRow
        {
            Focus = isMe, ClassPos = c.ClassPos, Overall = s.Place, Driver = s.Driver, Model = s.Model, Entry = s.Entry, Tyre = s.Tyre,
            Ve = s.Ve > 0 ? s.Ve : -1, S1 = s1, S2 = s2, S3 = s3, Best = b, BestFlag = bf, Last = l, LastFlag = lf, Avg = Avg5(s),
            Pit = s.InPits || s.InGarage, Laps = s.Laps, Pen = s.Penalties,
        };
        if (focus != null)
        {
            row.Gap = Gap(c, focus, cum, track);
            if (!isMe && s.Last > 0 && focus.S.Last > 0)
            {
                double dv = focus.S.Last - s.Last;
                row.Delta = new DeltaInfo { Has = true, Value = dv, Flag = dv > 0 ? 1 : 2 };
            }
        }
        return row;
    }

    /// <summary>Sectors to show (scoring sectors are cumulative): this lap's once S1 is done (S3 empty until the lap ends), else the last lap's. -1 = none.</summary>
    internal static (double s1, double s2, double s3) Sectors(CarSnap s)
    {
        if (s.Cur1 > 0) return (s.Cur1, s.Cur2 > s.Cur1 ? s.Cur2 - s.Cur1 : -1, -1);
        return (s.Last1 > 0 ? s.Last1 : -1,
                (s.Last1 > 0 && s.Last2 > s.Last1) ? s.Last2 - s.Last1 : -1,
                (s.Last2 > 0 && s.Last > s.Last2) ? s.Last - s.Last2 : -1);
    }

    double Avg5(CarSnap s)
    {
        if (!hist.TryGetValue(HKey(s), out var laps)) return -1;
        var v = laps.Where(x => x > 0 && (s.Best <= 0 || x < s.Best * 1.15)).ToList();
        if (v.Count < 2) return -1;
        var last5 = v.Skip(Math.Max(0, v.Count - 5)).ToList();
        return last5.Sum() / last5.Count;
    }

    /// <summary>Leaderboard gap: "laps" only when the cars are at least one full lap apart in DISTANCE covered (laps + lap distance / track length);
    /// the lap COUNTERS flip when a car crosses the line, which showed a false 1L for the seconds between two nearby cars crossing it.
    /// Otherwise the time = sum of "time behind next" between the two cars.</summary>
    GapInfo Gap(C x, C f, double[] cum, double track)
    {
        if (x == f) return new GapInfo();
        if (!race) return BestGap(x, f);
        string sg = x.Overall < f.Overall ? "+" : "-";
        if (track > 0)
        {
            double dp = Math.Abs(x.Prog - f.Prog);
            if (dp >= 1.0) return new GapInfo { Kind = "laps", Sign = sg, Value = Math.Floor(dp) };
        }
        else
        {
            int ld = Math.Abs(x.S.LapsBehindLeader - f.S.LapsBehindLeader);       // fallback when the track length is unknown
            if (ld >= 1) return new GapInfo { Kind = "laps", Sign = sg, Value = ld };
        }
        return new GapInfo { Kind = "time", Sign = sg, Value = Math.Abs(cum[x.Overall] - cum[f.Overall]) };
    }

    /// <summary>Practice / qualifying / warm-up: the game gives no time gaps (time behind next is 0) and laps covered mean nothing, so the gap is the
    /// best-lap difference (none while either has no lap).</summary>
    static GapInfo BestGap(C x, C f) => x.S.Best > 0 && f.S.Best > 0
        ? new GapInfo { Kind = "time", Sign = x.Overall < f.Overall ? "+" : "-", Value = Math.Abs(x.S.Best - f.S.Best) } : new GapInfo();
    bool race = true;                                                                      // the session of the last Build is a race (10-13)

    CardView Card(C x, C f, double[] cum) => new CardView
    {
        ClassPos = x.ClassPos, Driver = x.S.Driver, Last = x.S.Last > 0 ? x.S.Last : -1,
        Gap = !race ? BestGap(x, f) : new GapInfo { Kind = "time", Sign = x.Overall < f.Overall ? "+" : "-", Value = Math.Abs(cum[x.Overall] - cum[f.Overall]) },   // cards are always a time

        Delta = x.S.Last > 0 && f.S.Last > 0 ? new DeltaInfo { Has = true, Value = f.S.Last - x.S.Last, Flag = f.S.Last - x.S.Last > 0 ? 1 : 2 } : new DeltaInfo(),   // as the leaderboard's
    };
}
