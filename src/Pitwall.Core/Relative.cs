namespace Pitwall.Core;

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

/// <summary>The relative: every car on the track (not in the garage) ordered by the road distance to the focus car, half a lap each way.
/// Gap = road distance / lap length x the focus car's lap time: the game's estimate (mEstimatedLapTime, also there before the first lap), else its best,
/// else its last lap, else the class best.</summary>
public static class Relative
{
    public static List<RelCar> Build(SessionSnap s, IEnumerable<(CarSnap car, int classPos)> cars, CarSnap focus, double classBest)
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
            list.Add(new RelCar
            {
                Driver = c.Driver, Cls = c.Cls, ClassPos = pos, Me = c == focus, Pit = c.InPits,
                Gap = c == focus || lap <= 0 ? 0 : Math.Round(d / L * lap, 3), HasGap = lap > 0,
                Laps = race && c != focus ? (int)Math.Round((total - d) / L) : 0,
            });
            if (c != focus && lap <= 0) list[^1].Gap = d;                                  // no lap time: keep the order by distance
        }
        return list.OrderByDescending(r => r.Gap).ToList();
    }
}
