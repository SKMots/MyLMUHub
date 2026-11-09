namespace Pitwall.Core;

/// <summary>A lap cut into segments (about 150 m each): its time and each segment's time (s).</summary>
public sealed class SegmentLap
{
    public double Time { get; set; }
    public double[] Segs { get; set; } = Array.Empty<double>();
    /// <summary>The driving line of the lap: per reading [metres into the lap, x, z, km/h, throttle %, brake %] one after another
    /// (SegmentRecorder.Stride values each; -1 = not known), from the line to the line.</summary>
    public double[] Line { get; set; } = Array.Empty<double>();
}

/// <summary>Segments: finer than the game's 3 sectors. The lap is cut into Count(track length) equal pieces by distance; the time the car passes each cut
/// is read from the clock between two readings (interpolated on the distance), so a segment's time = when it left it minus when it came in.
/// Only a lap the GAME timed (a valid lap: a track cut has no time) and that did not touch the pits counts, and only when the segments add up to that time.
/// Also keeps where each segment is (world x, z at its start and middle, from the laps driven) so a page can draw them. Call it for your own car only.</summary>
public sealed class SegmentRecorder
{
    public const int Stride = 6;
    public static int Count(double trackLength) => Math.Clamp((int)Math.Round(trackLength / 150), 20, 90);

    public int N { get; private set; }
    public double Length { get; private set; }
    /// <summary>Per segment [x, z at its start, x, z at its middle] (0 0 0 0 = not seen yet).</summary>
    public double[][] Points { get; private set; } = Array.Empty<double[]>();
    /// <summary>Where sector 1 and sector 2 end (metres into the lap, -1 = not seen yet): the distance when the game's S1 / S2 time appears.</summary>
    public double[] SectorAt { get; private set; } = { -1, -1 };

    string key = ""; double[] cross = Array.Empty<double>(); double prevD = -1, prevEt = -1, prevX, prevZ;
    readonly List<double> trace = new(); double[] pendingTrace; double prevV = -1, prevThr = -1, prevBrk = -1;   // this lap's line, the finished lap's line
    double[] pending; double pendingAt = -1;                    // a lap's segments (line to line) waiting for the game's lap time
    double doneTime = -1, doneAt = -1; bool donePit;           // ... or the game's lap time came first
    readonly LapWatch watch = new();
    double prevCur1 = -1, prevCur2 = -1;

    /// <summary>Call every reading with your car. A finished, valid lap with all its segments; else null.</summary>
    public SegmentLap Update(RaceSnapshot snap, CarSnap car)
    {
        var s = snap.Session; double L = s.TrackLength, et = s.Et, d = car.LapDist;
        if (!(L > 0)) return null;
        if (d < 0 && d > -50) d = 0; else if (d > L && d < L + 50) d = L;                           // just round the line: a little below 0 / over the length
        string k = s.SessionId + "|" + s.TrackName + "|" + car.Slot;
        if (k != key) { key = k; N = Count(L); Length = L; Points = Enumerable.Range(0, N).Select(_ => new double[4]).ToArray(); NewLap(); prevD = -1; pending = null; doneTime = -1; watch.Reset(); SectorAt = new double[] { -1, -1 }; prevCur1 = prevCur2 = -1; }
        if (car.InGarage || d < 0 || d > L) { prevD = -1; NewLap(); }
        else if (prevD >= 0 && et > prevEt)
        {
            if (d >= prevD) Pass(prevD, d, et, car);
            else if (prevD - d > L / 2)                                                              // over the line
            {
                Pass(prevD, L, et, car, d + L - prevD);
                double t0 = cross[N]; var segs = Enumerable.Range(0, N).Select(i => cross[i + 1] - cross[i]).ToArray();
                double f = (L - prevD) / (d + L - prevD), lx = prevX + (car.X - prevX) * f, lz = prevZ + (car.Z - prevZ) * f;     // where it crossed the line
                double lv = Mix(prevV, Kmh(car), f), lt = Mix(prevThr, Thr(car), f), lb = Mix(prevBrk, Brk(car), f);
                Sample(L, lx, lz, lv, lt, lb); var line = trace.ToArray();
                NewLap(); cross[0] = t0; Sample(0, lx, lz, lv, lt, lb);
                if (segs.All(x => x > 0 && !double.IsNaN(x))) { pending = segs; pendingTrace = line; pendingAt = et; }
                Pass(0, d, et, car, d + L - prevD, L - prevD);
            }
            // a small step backwards (spun, reversing): nothing passed
        }
        if (!car.InGarage && d >= 0 && d <= L) Sample(d, car.X, car.Z, Kmh(car), Thr(car), Brk(car));
        if (d >= 0 && d <= L) { prevD = d; prevEt = et; prevX = car.X; prevZ = car.Z; prevV = Kmh(car); prevThr = Thr(car); prevBrk = Brk(car); }
        if (!car.InPits && d >= 0 && d <= L)                                                        // the sector lines: where this lap's S1 / S2 time appears
        {
            if (car.Cur1 > 0 && !(prevCur1 > 0)) SectorAt[0] = Math.Round(d, 1);
            if (car.Cur2 > 0 && !(prevCur2 > 0)) SectorAt[1] = Math.Round(d, 1);
        }
        prevCur1 = car.Cur1; prevCur2 = car.Cur2;

        SegmentLap lap = null;
        if (watch.Step(car.Laps, car.Last, car.InPits, out _, out double t, out bool pit)) { doneTime = t; donePit = pit; doneAt = et; }
        if (car.InPits) pending = null;
        if (pending != null && doneTime > 0 && Math.Abs(doneAt - pendingAt) < 5)
        {
            if (!donePit && Math.Abs(pending.Sum() - doneTime) < 0.5) lap = new SegmentLap { Time = doneTime, Segs = pending.Select(x => Math.Round(x, 3)).ToArray(), Line = Round(pendingTrace) };
            pending = null; doneTime = -1;
        }
        if (pending != null && et - pendingAt > 5) pending = null;                                  // no game lap time came: not a valid lap (cut, pit)
        return lap;
    }

    void NewLap() { cross = Enumerable.Repeat(double.NaN, N + 1).ToArray(); trace.Clear(); }

    // one reading of the line (only forwards: standing still or reversing adds nothing)
    void Sample(double d, double x, double z, double v, double thr, double brk)
    {
        if (trace.Count >= Stride && d <= trace[^Stride] + 0.5) return;
        trace.Add(d); trace.Add(x); trace.Add(z); trace.Add(v); trace.Add(thr); trace.Add(brk);
    }
    static double Kmh(CarSnap c) => c.Speed >= 0 ? c.Speed * 3.6 : -1;
    static double Thr(CarSnap c) => c.Detail != null && c.Detail.Throttle >= 0 ? c.Detail.Throttle * 100 : -1;
    static double Brk(CarSnap c) => c.Detail != null && c.Detail.BrakeIn >= 0 ? c.Detail.BrakeIn * 100 : -1;
    static double Mix(double a, double b, double f) => a < 0 || b < 0 ? b : a + (b - a) * f;
    static double[] Round(double[] t)
    {
        if (t == null) return Array.Empty<double>();
        var r = new double[t.Length];
        for (int i = 0; i < t.Length; i++) { int k = i % Stride; r[i] = k >= 4 ? (t[i] < 0 ? -1 : Math.Round(t[i])) : Math.Round(t[i], 1); }
        return r;
    }

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
