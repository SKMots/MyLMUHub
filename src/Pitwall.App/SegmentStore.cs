using System.IO;
using System.Text.Json;
using Pitwall.Core;

namespace Pitwall.App;

/// <summary>Your segment times (SegmentRecorder) per track + car: %AppData%\MyLMUHub\segments\*.json, one small file each, written once per valid lap.
/// Keeps the last 50 laps, your best ever time in every segment (and when), the best lap's own segments and where the segments are (to draw them),
/// where the sector lines are, and a small summary of every session (the last 100: laps within 5 % of your best lap, per segment their sum, sum of squares
/// and best) so the Improve page can say which places keep costing you time over many sessions.
/// Driving lines (where the car went, km/h, throttle, brake: SegmentLap.Line) go next to it, in segments\lines\(the same name)\: one file per lap
/// (the last 50, about 25 KB each), best.json (your best lap's line, kept) and optimal.json (per segment the line of the lap that set your best time there).</summary>
public sealed class SegmentStore
{
    public sealed class Lap { public long T { get; set; } public double Time { get; set; } public double[] Segs { get; set; } }
    /// <summary>A lap's driving line (a file in lines\): T = when (as in Laps), Line = SegmentLap.Line.</summary>
    public sealed class LineLap { public long T { get; set; } public double Time { get; set; } public double[] Line { get; set; } = Array.Empty<double>(); }
    /// <summary>optimal.json: per segment the piece of line of the lap that set your best time there (null = not driven with lines yet).</summary>
    public sealed class Optimal { public int N { get; set; } public double Length { get; set; } public LineLap[] Pieces { get; set; } = Array.Empty<LineLap>(); }
    const int KeepLines = 50;
    /// <summary>One session on this track + car (a new one after an hour without a lap).</summary>
    public sealed class Sess
    {
        public long Start { get; set; } public long End { get; set; } public int Laps { get; set; }
        public double[] Sum { get; set; } = Array.Empty<double>(); public double[] Sq { get; set; } = Array.Empty<double>(); public double[] Best { get; set; } = Array.Empty<double>();
    }
    public sealed class Record
    {
        public string Track { get; set; } = ""; public string Car { get; set; } = ""; public string Cls { get; set; } = "";
        public int N { get; set; } public double Length { get; set; } public long Updated { get; set; }
        public double[] Best { get; set; } = Array.Empty<double>();          // best ever per segment
        public long[] BestAt { get; set; } = Array.Empty<long>();            // when (unix s)
        public double BestLap { get; set; } = -1; public double[] BestLapSegs { get; set; } = Array.Empty<double>(); public long BestLapAt { get; set; }
        public double[][] Points { get; set; } = Array.Empty<double[]>();    // per segment [x, z start, x, z middle]
        public List<Lap> Laps { get; set; } = new();
        public double[] Sectors { get; set; } = { -1, -1 };                   // where S1 / S2 end (m), -1 = not known
        public List<Sess> Sessions { get; set; } = new();
    }

    static readonly JsonSerializerOptions Opt = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };
    readonly object gate = new();
    /// <summary>The guest driving now (Guests.Current), null = you: a guest's segments are kept in their own folder.</summary>
    public Func<string> Guest { get; set; }
    string Dir => Guest?.Invoke() is string g ? GuestDir(g) : Path.Combine(AppPaths.Dir, "segments");
    public static string GuestDir(string name) => Path.Combine(AppPaths.Dir, "segments", "guest", Guests.Safe(name));
    /// <summary>Changes with every lap stored (the page reloads only then).</summary>
    public int Generation { get; private set; }
    /// <summary>Guest mode switched: another folder now.</summary>
    public void Bump() { lock (gate) Generation++; }

    string FileOf(string track, string car, int n)
    {
        string safe = new string((track + "__" + car + "__" + n).Select(ch => char.IsLetterOrDigit(ch) || ch == '_' ? ch : '-').ToArray());
        return Path.Combine(Dir, safe + ".json");
    }

    public void Add(string track, string car, string cls, SegmentRecorder r, SegmentLap lap)
    {
        if (lap == null || lap.Segs.Length != r.N) return;
        lock (gate)
        {
            try
            {
                Directory.CreateDirectory(Dir);
                string f = FileOf(track, car, r.N);
                var rec = Load(f) ?? new Record { Track = track, Car = car, Cls = cls, N = r.N, Length = r.Length };
                long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                if (rec.Best.Length != r.N) { rec.Best = Enumerable.Repeat(-1.0, r.N).ToArray(); rec.BestAt = new long[r.N]; }
                var newBest = new List<int>();
                for (int i = 0; i < r.N; i++) if (rec.Best[i] < 0 || lap.Segs[i] < rec.Best[i]) { rec.Best[i] = lap.Segs[i]; rec.BestAt[i] = now; newBest.Add(i); }
                bool bestLap = rec.BestLap < 0 || lap.Time < rec.BestLap;
                if (bestLap) { rec.BestLap = lap.Time; rec.BestLapSegs = lap.Segs; rec.BestLapAt = now; }
                rec.Laps.Add(new Lap { T = now, Time = lap.Time, Segs = lap.Segs }); if (rec.Laps.Count > 50) rec.Laps.RemoveAt(0);
                rec.Points = r.Points.Select(p => (double[])p.Clone()).ToArray(); rec.Cls = cls; rec.Updated = now;
                if (rec.Sectors == null || rec.Sectors.Length != 2) rec.Sectors = new double[] { -1, -1 };
                for (int i = 0; i < 2; i++) if (r.SectorAt[i] > 0) rec.Sectors[i] = r.SectorAt[i];
                AddToSession(rec, lap, now);
                File.WriteAllText(f, JsonSerializer.Serialize(rec, Opt));
                if (lap.Line.Length >= SegmentRecorder.Stride * 20) SaveLine(LinesDir(f), r, lap, now, bestLap, newBest);
                Generation++;
            }
            catch (Exception) { }
        }
    }

    // a lap more than 5 % slower than your best lap (traffic, a spin) is left out of the session summary, as on the Race Pace page
    static void AddToSession(Record rec, SegmentLap lap, long now)
    {
        rec.Sessions ??= new();
        var s = rec.Sessions.Count > 0 ? rec.Sessions[^1] : null;
        if (s == null || now - s.End > 3600 || s.Sum.Length != rec.N)
        {
            s = new Sess { Start = now, End = now, Sum = new double[rec.N], Sq = new double[rec.N], Best = Enumerable.Repeat(-1.0, rec.N).ToArray() };
            rec.Sessions.Add(s); if (rec.Sessions.Count > 100) rec.Sessions.RemoveAt(0);
        }
        s.End = now;
        if (!(rec.BestLap > 0) || lap.Time > rec.BestLap * 1.05) return;
        s.Laps++;
        for (int i = 0; i < rec.N; i++)
        {
            double v = lap.Segs[i]; s.Sum[i] = Math.Round(s.Sum[i] + v, 3); s.Sq[i] = Math.Round(s.Sq[i] + v * v, 3);
            if (s.Best[i] < 0 || v < s.Best[i]) s.Best[i] = v;
        }
    }

    static string LinesDir(string recFile) => Path.Combine(Path.GetDirectoryName(recFile), "lines", Path.GetFileNameWithoutExtension(recFile));

    // the lap's line: its own file (the oldest past 50 go), best.json when it is your best lap, its pieces in optimal.json where it set a best segment
    static void SaveLine(string dir, SegmentRecorder r, SegmentLap lap, long now, bool bestLap, List<int> newBest)
    {
        try
        {
            Directory.CreateDirectory(dir);
            string json = JsonSerializer.Serialize(new LineLap { T = now, Time = lap.Time, Line = lap.Line }, Opt);
            File.WriteAllText(Path.Combine(dir, now + ".json"), json);
            foreach (var t in LapFiles(dir).Skip(KeepLines)) File.Delete(Path.Combine(dir, t + ".json"));
            if (bestLap) File.WriteAllText(Path.Combine(dir, "best.json"), json);
            if (newBest.Count > 0)
            {
                string of = Path.Combine(dir, "optimal.json"); Optimal opt = null;
                try { if (File.Exists(of)) opt = JsonSerializer.Deserialize<Optimal>(File.ReadAllText(of), Opt); } catch (Exception) { }
                if (opt == null || opt.N != r.N || opt.Pieces == null || opt.Pieces.Length != r.N) opt = new Optimal { N = r.N, Length = r.Length, Pieces = new LineLap[r.N] };
                double step = r.Length / r.N;
                foreach (int i in newBest) opt.Pieces[i] = new LineLap { T = now, Time = lap.Segs[i], Line = Piece(lap.Line, i * step, (i + 1) * step) };
                File.WriteAllText(of, JsonSerializer.Serialize(opt, Opt));
            }
        }
        catch (Exception) { }
    }
    // the lap files in a lines folder (their times), newest first
    static List<long> LapFiles(string dir) => Directory.GetFiles(dir, "*.json").Select(x => long.TryParse(Path.GetFileNameWithoutExtension(x), out long v) ? v : -1)
        .Where(t => t > 0).OrderByDescending(t => t).ToList();
    // the readings from a to b (metres), with the one before and the one after, so the pieces join up
    public static double[] Piece(double[] line, double a, double b)
    {
        int S = SegmentRecorder.Stride, n = line.Length / S, i0 = 0, i1 = n - 1;
        while (i0 < n - 1 && line[(i0 + 1) * S] <= a) i0++;
        while (i1 > 0 && line[(i1 - 1) * S] >= b) i1--;
        if (n == 0 || i1 < i0) return Array.Empty<double>();
        return line.Skip(i0 * S).Take((i1 - i0 + 1) * S).ToArray();
    }

    /// <summary>/api/segments?key=&amp;line=: list = { best: {t, time} | null, optimal: pieces known, n, laps: [{t, time}] newest first };
    /// best / optimal / a lap's t = that file as it is. null = none.</summary>
    public string Line(string key, string which)
    {
        if (string.IsNullOrEmpty(key) || key != Path.GetFileName(key) || !key.EndsWith(".json")) return null;
        lock (gate)
        {
            try
            {
                string dir = LinesDir(Path.Combine(Dir, key));
                if (which == "list")
                {
                    var laps = new List<object>(); object best = null; int pieces = 0, n = 0;
                    if (Directory.Exists(dir))
                    {
                        var rec = Load(Path.Combine(Dir, key));
                        foreach (long t in LapFiles(dir)) laps.Add(new { t, time = rec?.Laps.FirstOrDefault(x => x.T == t)?.Time ?? -1 });
                        string bf = Path.Combine(dir, "best.json");
                        if (File.Exists(bf)) { var b = JsonSerializer.Deserialize<LineLap>(File.ReadAllText(bf), Opt); if (b != null) best = new { t = b.T, time = b.Time }; }
                        string of = Path.Combine(dir, "optimal.json");
                        if (File.Exists(of)) { var o = JsonSerializer.Deserialize<Optimal>(File.ReadAllText(of), Opt); if (o?.Pieces != null) { n = o.N; pieces = o.Pieces.Count(x => x != null && x.Line.Length > 0); } }
                    }
                    return JsonSerializer.Serialize(new { best, optimal = pieces, n, laps }, Opt);
                }
                string file = which == "best" || which == "optimal" ? which : long.TryParse(which, out long tt) && tt > 0 ? tt.ToString() : null;
                if (file == null) return null;
                string path = Path.Combine(dir, file + ".json");
                return File.Exists(path) ? File.ReadAllText(path) : null;
            }
            catch (Exception) { return null; }
        }
    }

    static Record Load(string f) { try { return File.Exists(f) ? JsonSerializer.Deserialize<Record>(File.ReadAllText(f), Opt) : null; } catch (Exception) { return null; } }

    /// <summary>/api/segments: { gen, list: [{ key, track, car, cls, n, laps, bestLap, theoretical, updated }] }; with key: that whole record.</summary>
    public object Info(string key)
    {
        lock (gate)
        {
            if (!string.IsNullOrEmpty(key))
            {
                if (key != Path.GetFileName(key) || !key.EndsWith(".json")) return null;
                return Load(Path.Combine(Dir, key));
            }
            var list = new List<object>();
            if (Directory.Exists(Dir))
                foreach (var f in Directory.GetFiles(Dir, "*.json"))
                {
                    var r = Load(f); if (r == null) continue;
                    list.Add(new { key = Path.GetFileName(f), track = r.Track, car = r.Car, cls = r.Cls, n = r.N, laps = r.Laps.Count, bestLap = r.BestLap,
                                   theoretical = r.Best.All(b => b > 0) ? Math.Round(r.Best.Sum(), 3) : -1, updated = r.Updated });
                }
            return new { gen = Generation, list };
        }
    }
}
