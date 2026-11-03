using System.IO;
using System.Text.Json;
using Pitwall.Core;

namespace Pitwall.App;

/// <summary>Your segment times (SegmentRecorder) per track + car: %AppData%\MyLMUHub\segments\*.json, one small file each, written once per valid lap.
/// Keeps the last 50 laps, your best ever time in every segment (and when), the best lap's own segments and where the segments are (to draw them).</summary>
public sealed class SegmentStore
{
    public sealed class Lap { public long T { get; set; } public double Time { get; set; } public double[] Segs { get; set; } }
    public sealed class Record
    {
        public string Track { get; set; } = ""; public string Car { get; set; } = ""; public string Cls { get; set; } = "";
        public int N { get; set; } public double Length { get; set; } public long Updated { get; set; }
        public double[] Best { get; set; } = Array.Empty<double>();          // best ever per segment
        public long[] BestAt { get; set; } = Array.Empty<long>();            // when (unix s)
        public double BestLap { get; set; } = -1; public double[] BestLapSegs { get; set; } = Array.Empty<double>(); public long BestLapAt { get; set; }
        public double[][] Points { get; set; } = Array.Empty<double[]>();    // per segment [x, z start, x, z middle]
        public List<Lap> Laps { get; set; } = new();
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
                for (int i = 0; i < r.N; i++) if (rec.Best[i] < 0 || lap.Segs[i] < rec.Best[i]) { rec.Best[i] = lap.Segs[i]; rec.BestAt[i] = now; }
                if (rec.BestLap < 0 || lap.Time < rec.BestLap) { rec.BestLap = lap.Time; rec.BestLapSegs = lap.Segs; rec.BestLapAt = now; }
                rec.Laps.Add(new Lap { T = now, Time = lap.Time, Segs = lap.Segs }); if (rec.Laps.Count > 50) rec.Laps.RemoveAt(0);
                rec.Points = r.Points.Select(p => (double[])p.Clone()).ToArray(); rec.Cls = cls; rec.Updated = now;
                File.WriteAllText(f, JsonSerializer.Serialize(rec, Opt));
                Generation++;
            }
            catch (Exception) { }
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
