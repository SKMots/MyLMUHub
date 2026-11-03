namespace Pitwall.Core;

/// <summary>
/// Top bar logic (SimHub "LMU Pitwall v4.21" top bar, docs/DASHBOARD-SPEC.md). For the FOCUS car, so it works while spectating.
/// Best lap / sectors = personal bests of the driver in the car (never the team-mate's). Delta = the game's own mDeltaBest, assumed to be
/// relative to the car's best lap (mBestLapTime), so EST = car best + delta.
/// </summary>
public static class TopBar
{
    /// <summary>prevLast = the lap before the last one (-1 = none): LastDiff = last lap - that lap (owner: + slower / - faster than the lap before).</summary>
    public static TopBarView Build(SessionSnap ses, CarSnap f, int classPos, double classBest, PersonalBests pbs, double prevLast = -1)
    {
        const double Eps = StandingsEngine.Eps;
        var v = new TopBarView { Session = ses.SessionId, TimeLeft = (ses.EndEt > 0 && ses.EndEt >= ses.Et) ? ses.EndEt - ses.Et : -1 };
        if (f == null) return v;

        v.Has = true; v.ClassPos = classPos; v.Overall = f.Place; v.Lap = f.Laps + 1;
        double lapRef = f.Last > 0 ? f.Last : f.Best;                                   // laps left in a timed session: time left / last lap (else best)
        if (ses.MaxLaps > 0) v.LapsLeft = Math.Max(0, ses.MaxLaps - f.Laps);
        else if (v.TimeLeft >= 0 && lapRef > 0) v.LapsLeft = v.TimeLeft / lapRef;

        var pb = pbs.Get(f);
        v.Last = f.Last > 0 ? f.Last : -1;
        v.Best = pb.Lap > 0 ? pb.Lap : -1;
        if (v.Last > 0 && classBest > 0 && v.Last <= classBest + Eps) v.LastFlag = 1;
        else if (v.Last > 0 && v.Best > 0 && v.Last <= v.Best + Eps) v.LastFlag = 2;
        if (v.Last > 0 && prevLast > 0) v.LastDiff = v.Last - prevLast;
        if (v.Best > 0) v.BestFlag = (classBest > 0 && v.Best <= classBest + Eps) ? 1 : 2;

        v.Cur = f.LapTime > 0 ? f.LapTime : -1;
        if (f.DeltaBest.HasValue && f.Best > 0) { v.Delta = f.DeltaBest.Value; v.Est = f.Best + f.DeltaBest.Value; }   // no best lap yet: nothing to compare with

        var (s1, s2, s3) = StandingsEngine.Sectors(f);
        double[] val = { s1, s2, s3 }, mine = { pb.S1, pb.S2, pb.S3 }, cls = pbs.ClassBestSectors(f.Cls);
        for (int i = 0; i < 3; i++)
        {
            var b = new SectorBox { Value = val[i] > 0 ? val[i] : -1 };
            if (b.Value > 0)
            {
                if (mine[i] > 0) b.Diff = b.Value - mine[i];
                b.Flag = (cls[i] > 0 && b.Value <= cls[i] + Eps) ? 1 : (mine[i] > 0 && b.Value <= mine[i] + Eps) ? 2 : 3;
            }
            v.Sectors.Add(b);
        }
        return v;
    }
}
