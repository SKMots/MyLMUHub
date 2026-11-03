namespace Pitwall.Core;

/// <summary>Flags on the track map (like a TV broadcast): green, a local yellow (which sectors, where, how far ahead of the focus car) or a full-course yellow.</summary>
public sealed class FlagView
{
    public string State { get; set; } = "none";       // none (no data) | green | yellow (local) | fcy (full course yellow)
    public List<int> Sectors { get; set; } = new();     // the sectors with a local yellow (1..3)
    public List<double[][]> Zones { get; set; } = new();// the stretches of track to light up: world points [x, z] (the map draws them over the line)
    public double Ahead { get; set; } = -1;             // metres from the focus car to the nearest incident ahead of it on the lap, -1 = none / not known
    public int Incidents { get; set; }                  // slow / stopped cars in yellow sectors
}

/// <summary>The game gives a yellow per SECTOR (mSectorFlag) and the full-course state (mYellowFlagState), not where the incident is. So the incident =
/// a car on the track (not in the pits) going very slowly in a yellow sector; its stretch (+-Around metres) lights up. A yellow sector without such a car
/// lights up whole. Learned per track (memory only, within a lap or two): where the sectors end (where the cars' sector-1 / sector-2 times appear) and a
/// position for every bit of the lap (to draw a stretch). Numbers only.</summary>
public sealed class FlagWatch
{
    const int Bins = 200; public const double Slow = 8, Around = 150;      // m/s (~30 km/h); metres either side of an incident
    readonly double[] x = new double[Bins], z = new double[Bins]; readonly int[] n = new int[Bins];
    readonly List<double> end1 = new(), end2 = new();
    readonly Dictionary<int, (bool S1, bool S2)> seen = new();
    string track = "";

    public void Learn(RaceSnapshot snap)
    {
        var s = snap.Session; double L = s.TrackLength;
        if (s.TrackName != track) { track = s.TrackName; Array.Clear(x); Array.Clear(z); Array.Clear(n); end1.Clear(); end2.Clear(); seen.Clear(); }
        if (!(L > 0)) return;
        foreach (var c in snap.Cars)
        {
            if (c.InPits || c.InGarage || c.LapDist < 0 || c.LapDist > L) { seen.Remove(c.Slot); continue; }
            int b = Math.Min(Bins - 1, (int)(c.LapDist / L * Bins));
            if (n[b] < 8 && c.Speed > 15 && !(c.X == 0 && c.Z == 0)) { n[b]++; x[b] += (c.X - x[b]) / n[b]; z[b] += (c.Z - z[b]) / n[b]; }
            bool s1 = c.Cur1 > 0, s2 = c.Cur2 > 0;                                                  // sector 1 / 2 time of this lap appears = the car just crossed that line
            if (seen.TryGetValue(c.Slot, out var was))
            {
                if (s1 && !was.S1) Add(end1, c.LapDist / L);
                if (s2 && !was.S2) Add(end2, c.LapDist / L);
            }
            seen[c.Slot] = (s1, s2);
        }
    }
    static void Add(List<double> l, double f) { if (f <= 0 || f >= 1) return; l.Add(f); if (l.Count > 15) l.RemoveAt(0); }
    static double Median(List<double> l) { if (l.Count == 0) return -1; var s = l.OrderBy(v => v).ToList(); return s[s.Count / 2]; }

    /// <summary>Sector ends as lap fractions (S1 end, S2 end), -1 = not learned yet.</summary>
    public (double S1, double S2) Ends => (Median(end1), Median(end2));

    public FlagView Build(RaceSnapshot snap, CarSnap focus)
    {
        var s = snap.Session; var v = new FlagView(); double L = s.TrackLength;
        if (s.YellowState < 0 && s.GamePhase < 0) return v;                                         // no flag data (a JSON replay)
        if (s.GamePhase == 6 || s.YellowState >= 1 && s.YellowState <= 6) { v.State = "fcy"; return v; }
        for (int i = 0; i < 3; i++) if (s.SectorYellow[i]) v.Sectors.Add(i + 1);
        v.State = v.Sectors.Count > 0 ? "yellow" : "green";
        if (v.Sectors.Count == 0 || !(L > 0)) return v;
        var (e1, e2) = Ends;
        int SectorOf(double f) => e1 > 0 && e2 > e1 ? (f < e1 ? 1 : f < e2 ? 2 : 3) : 0;           // 0 = not learned yet
        var inc = snap.Cars.Where(c => !c.InPits && !c.InGarage && c.Speed >= 0 && c.Speed < Slow && c.LapDist >= 0 && c.LapDist <= L)
                           .Select(c => c.LapDist / L).Where(f => { int k = SectorOf(f); return k == 0 || v.Sectors.Contains(k); }).ToList();
        v.Incidents = inc.Count;
        foreach (var f in inc) Zone(v, f - Around / L, f + Around / L);
        foreach (int k in v.Sectors)                                                                 // a yellow sector with no slow car found: all of it
            if (e1 > 0 && e2 > e1 && !inc.Any(f => SectorOf(f) == k)) Zone(v, k == 1 ? 0 : k == 2 ? e1 : e2, k == 1 ? e1 : k == 2 ? e2 : 1);
        if (focus != null && inc.Count > 0 && !focus.InPits)
        {
            double me = focus.LapDist / L; v.Ahead = Math.Round(inc.Select(f => ((f - me) % 1 + 1) % 1).Min() * L);
        }
        return v;
    }

    // the learned points from lap fraction a to b (may wrap past the line) as one or two paths
    void Zone(FlagView v, double a, double b)
    {
        var pts = new List<double[]>();
        int i0 = (int)Math.Floor(a * Bins), i1 = (int)Math.Ceiling(b * Bins);
        for (int i = i0; i <= i1; i++)
        {
            int k = ((i % Bins) + Bins) % Bins;
            if (n[k] == 0) { if (pts.Count > 1) v.Zones.Add(pts.ToArray()); pts = new List<double[]>(); continue; }
            pts.Add(new[] { Math.Round(x[k], 1), Math.Round(z[k], 1) });
        }
        if (pts.Count > 1) v.Zones.Add(pts.ToArray());
    }
}
