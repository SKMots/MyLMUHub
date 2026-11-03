namespace Pitwall.Core;

/// <summary>A lap cut into segments (about 150 m each): its time and each segment's time (s).</summary>
public sealed class SegmentLap
{
    public double Time { get; set; }
    public double[] Segs { get; set; } = Array.Empty<double>();
}

/// <summary>Segments: finer than the game's 3 sectors. The lap is cut into Count(track length) equal pieces by distance; the time the car passes each cut
/// is read from the clock between two readings (interpolated on the distance), so a segment's time = when it left it minus when it came in.
/// Only a lap the GAME timed (a valid lap: a track cut has no time) and that did not touch the pits counts, and only when the segments add up to that time.
/// Also keeps where each segment is (world x, z at its start and middle, from the laps driven) so a page can draw them. Call it for your own car only.</summary>
public sealed class SegmentRecorder
{
    public static int Count(double trackLength) => Math.Clamp((int)Math.Round(trackLength / 150), 20, 90);

    public int N { get; private set; }
    public double Length { get; private set; }
    /// <summary>Per segment [x, z at its start, x, z at its middle] (0 0 0 0 = not seen yet).</summary>
    public double[][] Points { get; private set; } = Array.Empty<double[]>();

    string key = ""; double[] cross = Array.Empty<double>(); double prevD = -1, prevEt = -1, prevX, prevZ;
    double[] pending; double pendingAt = -1;                    // a lap's segments (line to line) waiting for the game's lap time
    double doneTime = -1, doneAt = -1; bool donePit;           // ... or the game's lap time came first
    readonly LapWatch watch = new();

    /// <summary>Call every reading with your car. A finished, valid lap with all its segments; else null.</summary>
    public SegmentLap Update(RaceSnapshot snap, CarSnap car)
    {
        var s = snap.Session; double L = s.TrackLength, et = s.Et, d = car.LapDist;
        if (!(L > 0)) return null;
        if (d < 0 && d > -50) d = 0; else if (d > L && d < L + 50) d = L;                           // just round the line: a little below 0 / over the length
        string k = s.SessionId + "|" + s.TrackName + "|" + car.Slot;
        if (k != key) { key = k; N = Count(L); Length = L; Points = Enumerable.Range(0, N).Select(_ => new double[4]).ToArray(); NewLap(); prevD = -1; pending = null; doneTime = -1; watch.Reset(); }
        if (car.InGarage || d < 0 || d > L) { prevD = -1; NewLap(); }
        else if (prevD >= 0 && et > prevEt)
        {
            if (d >= prevD) Pass(prevD, d, et, car);
            else if (prevD - d > L / 2)                                                              // over the line
            {
                Pass(prevD, L, et, car, d + L - prevD);
                double t0 = cross[N]; var segs = Enumerable.Range(0, N).Select(i => cross[i + 1] - cross[i]).ToArray();
                NewLap(); cross[0] = t0;
                if (segs.All(x => x > 0 && !double.IsNaN(x))) { pending = segs; pendingAt = et; }
                Pass(0, d, et, car, d + L - prevD, L - prevD);
            }
            // a small step backwards (spun, reversing): nothing passed
        }
        if (d >= 0 && d <= L) { prevD = d; prevEt = et; prevX = car.X; prevZ = car.Z; }

        SegmentLap lap = null;
        if (watch.Step(car.Laps, car.Last, car.InPits, out _, out double t, out bool pit)) { doneTime = t; donePit = pit; doneAt = et; }
        if (car.InPits) pending = null;
        if (pending != null && doneTime > 0 && Math.Abs(doneAt - pendingAt) < 5)
        {
            if (!donePit && Math.Abs(pending.Sum() - doneTime) < 0.5) lap = new SegmentLap { Time = doneTime, Segs = pending.Select(x => Math.Round(x, 3)).ToArray() };
            pending = null; doneTime = -1;
        }
        if (pending != null && et - pendingAt > 5) pending = null;                                  // no game lap time came: not a valid lap (cut, pit)
        return lap;
    }

    void NewLap() { cross = Enumerable.Repeat(double.NaN, N + 1).ToArray(); }

    // the car went from distance a to b (metres into the lap) between the last reading and this one: the times of the cuts it passed.
    // span = metres covered in that step (from the last reading), off = metres of it before a (over the line)
    void Pass(double a, double b, double et, CarSnap car, double span = -1, double off = 0)
    {
        if (span < 0) span = b - a; if (span <= 0) return;
        double step = Length / N;
        for (int i = (int)Math.Floor(a / step) + 1; i * step <= b + 1e-9 && i <= N; i++)
        {
            double f = (off + i * step - a) / span;
            cross[i] = prevEt + (et - prevEt) * f;
            if (i < N) { Points[i][0] = Math.Round(prevX + (car.X - prevX) * f, 1); Points[i][1] = Math.Round(prevZ + (car.Z - prevZ) * f, 1); }
            else { Points[0][0] = Math.Round(prevX + (car.X - prevX) * f, 1); Points[0][1] = Math.Round(prevZ + (car.Z - prevZ) * f, 1); }
        }
        for (int i = (int)Math.Floor(a / step - 0.5) + 1; (i + 0.5) * step <= b + 1e-9 && i < N; i++)          // the middles: where to draw
        {
            if (i < 0) continue; double f = (off + (i + 0.5) * step - a) / span;
            Points[i][2] = Math.Round(prevX + (car.X - prevX) * f, 1); Points[i][3] = Math.Round(prevZ + (car.Z - prevZ) * f, 1);
        }
    }
}
