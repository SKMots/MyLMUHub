namespace MyLMUHub.Core;

/// <summary>One car in the relative view (as the game's HUD relative): where it is on the track compared with the focus car.</summary>
public sealed class RelCar
{
    public string Driver { get; set; } = "";
    public string Cls { get; set; } = "";
    public int ClassPos { get; set; }
    public bool Me { get; set; }                 // the focus car
    public bool Pit { get; set; }
    public double Gap { get; set; }              // seconds on track: + = ahead of the focus car on the road, - = behind; 0 for the focus car
    public bool HasGap { get; set; }             // false = no lap time known yet (only the order is right)
    public int Laps { get; set; }                // race only: + = this many laps ahead of the focus car in the race, - = laps behind (lapped)
}

/// <summary>How far into a lap (as a share of the lap time) a car of the focus class is at every bit of the track, learned while they drive (time into the lap /
/// that car's lap time, 200 bits per lap). A straight is quick, a corner slow: the share does not grow evenly with the distance, so a gap in metres is not a
/// gap in seconds (owner, 2026-11-10: the relative was up to a second off on and off). Memory only, per track; ready once nearly every bit was seen.</summary>
public sealed class LapProfile
{
    const int Bins = 200;
    readonly double[] f = new double[Bins]; readonly int[] n = new int[Bins];
    string track = ""; int seen;
    public bool Ready => seen >= Bins * 0.95;

    public void Learn(RaceSnapshot snap, string cls)
    {
        var s = snap.Session; double L = s.TrackLength;
        if (s.TrackName != track) { track = s.TrackName; Array.Clear(f); Array.Clear(n); seen = 0; }
        if (!(L > 0)) return;
        foreach (var c in snap.Cars)
        {
            if (c.InPits || c.InGarage || !(c.LapTime > 0) || c.LapDist < 0 || c.LapDist >= L || c.Speed < 15) continue;
            if (cls != null && c.Cls != cls) continue;
            double lap = c.EstLap > 0 ? c.EstLap : c.Last > 0 ? c.Last : c.Best; if (!(lap > 0)) continue;
            double x = c.LapDist / L, share = c.LapTime / lap;
            if (Math.Abs(share - x) > 0.3) continue;                                                 // just over the line, or the lap clock not reset yet
            int b = Math.Min(Bins - 1, (int)(x * Bins));
            double v = share + ((b + 0.5) / Bins - x);                                               // moved to the middle of its bit (evenly, it is a short bit)
            if (n[b] == 0) seen++;
            if (n[b] < 10) { n[b]++; f[b] += (v - f[b]) / n[b]; } else f[b] += (v - f[b]) * 0.1;
        }
    }

    /// <summary>The share of the lap time at d metres into the lap (between the bits' middles; missing bits: as if evenly).</summary>
    public double At(double d, double L)
    {
        double x = d / L * Bins - 0.5; int i0 = (int)Math.Floor(x); double t = x - i0;
        double F(int i) { int k = ((i % Bins) + Bins) % Bins; double off = i < 0 ? -1 : i >= Bins ? 1 : 0; return (n[k] > 0 ? f[k] : (k + 0.5) / Bins) + off; }
        return F(i0) + (F(i0 + 1) - F(i0)) * t;
    }
}

/// <summary>The relative: every car on the track (not in the garage) ordered by the road distance to the focus car, half a lap each way.
/// Gap = the time the focus car needs to get where the other car is: the lap profile (share of the lap time at each bit of the track, LapProfile) between the
/// two places x the focus car's lap time: the game's estimate (mEstimatedLapTime, also there before the first lap), else its best, else its last lap, else
/// the class best. Until the profile is learned (about a lap): road distance / lap length x that lap time.</summary>
public static class Relative
{
    public static List<RelCar> Build(SessionSnap s, IEnumerable<(CarSnap car, int classPos)> cars, CarSnap focus, double classBest, LapProfile profile = null)
    {
        var list = new List<RelCar>();
        double L = s.TrackLength;
        if (focus == null || L <= 0) return list;
        double lap = focus.EstLap > 0 ? focus.EstLap : focus.Best > 0 ? focus.Best : focus.Last > 0 ? focus.Last : classBest;
        bool race = s.SessionId >= 10 && s.SessionId <= 13;
        foreach (var (c, pos) in cars)
        {
            if (c.InGarage && c != focus) continue;
            double d = c.LapDist - focus.LapDist;
            if (d > L / 2) d -= L; else if (d <= -L / 2) d += L;                          // the shorter way round
            double total = (c.Laps - focus.Laps) * L + (c.LapDist - focus.LapDist);        // race distance between the two
            double share = d / L;
            if (profile != null && profile.Ready && c != focus)
            {
                share = profile.At(c.LapDist, L) - profile.At(focus.LapDist, L);
                if (d > 0 && share < 0) share += 1; else if (d < 0 && share > 0) share -= 1;           // the same way round as the distance
            }
            list.Add(new RelCar
            {
                Driver = c.Driver, Cls = c.Cls, ClassPos = pos, Me = c == focus, Pit = c.InPits,
                Gap = c == focus || lap <= 0 ? 0 : Math.Round(share * lap, 3), HasGap = lap > 0,
                Laps = race && c != focus ? (int)Math.Round((total - d) / L) : 0,
            });
            if (c != focus && lap <= 0) list[^1].Gap = d;                                  // no lap time: keep the order by distance
        }
        return list.OrderByDescending(r => r.Gap).ToList();
    }
}
