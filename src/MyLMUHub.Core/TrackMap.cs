using System.Text.Json;

namespace MyLMUHub.Core;

/// <summary>The outline of the current track, as world-space paths (x, z) for the map widget. Two sources:
/// 1) the GAME's own track map (web API, see TrackMapParse) - complete straight away, incl. the pit lane; 2) LEARNED from where the cars drive: the lap is
/// cut into Bins pieces (by distance round the lap) and each piece keeps the average position of the cars seen in it (not in the pits); with a full field
/// complete within a lap. A complete outline is kept (the app saves it per track) and no longer changes. The cars themselves are placed by their position.</summary>
public sealed class TrackMap
{
    public const int Bins = 400;
    const int Enough = 8;                                // samples per piece before it stops moving
    readonly double[] x = new double[Bins], z = new double[Bins];
    readonly int[] n = new int[Bins];
    int filled; double lastBump = double.MinValue;
    List<double[][]> gamePaths;
    public string Track { get; private set; } = "";
    public int Version { get; private set; }
    public bool Complete { get; private set; }
    /// <summary>"game" (the game's own map) or "learned".</summary>
    public string Source => gamePaths != null ? "game" : "learned";

    /// <summary>A different track starts over (the app then offers a saved / game outline).</summary>
    public bool Learn(RaceSnapshot snap)
    {
        var s = snap.Session; bool changed = false;
        if (s.TrackName != Track) { Clear(s.TrackName); changed = true; }
        if (Complete || !(s.TrackLength > 0)) return changed;
        foreach (var c in snap.Cars)
        {
            if (c.InPits || c.InGarage || c.LapDist < 0 || c.LapDist > s.TrackLength || (c.X == 0 && c.Z == 0)) continue;
            int b = Math.Min(Bins - 1, (int)(c.LapDist / s.TrackLength * Bins));
            if (n[b] >= Enough) continue;
            if (n[b] == 0) filled++;
            n[b]++; x[b] += (c.X - x[b]) / n[b]; z[b] += (c.Z - z[b]) / n[b];
        }
        if (filled >= Bins * 0.98 && Enumerable.Range(0, Bins).All(i => n[i] == 0 || n[i] >= 2)) Complete = true;
        if (Complete || s.Et - lastBump >= 3) { lastBump = s.Et; Version++; changed = true; }       // page updates the drawing at most every 3 s while learning
        return changed;
    }

    void Clear(string track)
    {
        Track = track ?? ""; Array.Clear(x); Array.Clear(z); Array.Clear(n); filled = 0; Complete = false; lastBump = double.MinValue; gamePaths = null; Version++;
    }

    /// <summary>Learned points round the lap, null where nothing was seen yet.</summary>
    public double[][] Points() => Enumerable.Range(0, Bins).Select(i => n[i] > 0 ? new[] { Math.Round(x[i], 1), Math.Round(z[i], 1) } : null).ToArray();

    /// <summary>What the page draws: the game's paths, else the learned points as one path (null = a gap).</summary>
    public List<double[][]> Paths() => gamePaths ?? new List<double[][]> { Points() };

    /// <summary>A saved learned outline for this track (complete).</summary>
    public void Load(string track, double[][] pts)
    {
        if (pts == null || pts.Length != Bins) return;
        Clear(track);
        for (int i = 0; i < Bins; i++) if (pts[i] != null && pts[i].Length == 2) { x[i] = pts[i][0]; z[i] = pts[i][1]; n[i] = Enough; filled++; }
        Complete = true; Version++;
    }

    /// <summary>The game's own map of this track (complete; nothing is learned any more).</summary>
    public void LoadGame(string track, List<double[][]> paths)
    {
        if (paths == null || paths.Count == 0) return;
        Clear(track); gamePaths = paths; Complete = true; Version++;
    }

    /// <summary>The saved form: { source, paths } (a learned outline keeps its 400 points as the one path).</summary>
    public string SaveJson() => JsonSerializer.Serialize(new { source = Source, paths = Paths() });

    /// <summary>A saved file of either form (also the older plain list of 400 learned points). False when it is not usable.</summary>
    public bool LoadSaved(string track, string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var r = doc.RootElement;
            if (r.ValueKind == JsonValueKind.Array) { var pts = JsonSerializer.Deserialize<double[][]>(json); if (pts?.Length != Bins) return false; Load(track, pts); return true; }
            var paths = JsonSerializer.Deserialize<List<double[][]>>(r.GetProperty("paths").GetRawText());
            if (r.TryGetProperty("source", out var src) && src.GetString() == "game") { LoadGame(track, paths); return gamePaths != null; }
            if (paths?.Count == 1 && paths[0].Length == Bins) { Load(track, paths[0]); return true; }
        }
        catch (Exception) { }
        return false;
    }
}

/// <summary>The game's track map from its web API (GET rest/watch/trackmap). ASSUMED shape (not yet verified live): somewhere in the answer a list of points
/// with numbers x, y, z (y = up, so the map uses x and z; x and y if there is no z), optionally with a "type" (racing line, pit lane, ...): each type is its own
/// path, in the order given. Null when nothing usable is found.</summary>
public static class TrackMapParse
{
    public static List<double[][]> Parse(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var list = new List<JsonElement>(); Collect(doc.RootElement, list);
            if (list.Count < 50) return null;
            var groups = new List<(string type, List<double[]> pts)>();
            foreach (var p in list)
            {
                double px = Num(p, "x"), pz = Has(p, "z") ? Num(p, "z") : Num(p, "y");
                string type = p.TryGetProperty("type", out var t) ? t.ToString() : "";
                var g = groups.FirstOrDefault(q => q.type == type);
                if (g.pts == null) { g = (type, new List<double[]>()); groups.Add(g); }
                g.pts.Add(new[] { Math.Round(px, 1), Math.Round(pz, 1) });
            }
            var paths = groups.Where(g => g.pts.Count >= 20).Select(g => g.pts.ToArray()).ToList();
            return paths.Count > 0 ? paths : null;
        }
        catch (Exception) { return null; }
    }

    // the largest array of objects that have numbers x and (z or y), searched depth-first
    static void Collect(JsonElement e, List<JsonElement> best)
    {
        if (e.ValueKind == JsonValueKind.Array)
        {
            var pts = e.EnumerateArray().Where(i => i.ValueKind == JsonValueKind.Object && IsNum(i, "x") && (IsNum(i, "z") || IsNum(i, "y"))).ToList();
            if (pts.Count > best.Count) { best.Clear(); best.AddRange(pts); }
            foreach (var i in e.EnumerateArray()) Collect(i, best);
        }
        else if (e.ValueKind == JsonValueKind.Object) foreach (var p in e.EnumerateObject()) Collect(p.Value, best);
    }
    static bool Has(JsonElement o, string k) => IsNum(o, k);
    static bool IsNum(JsonElement o, string k) => o.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number;
    static double Num(JsonElement o, string k) => o.GetProperty(k).GetDouble();
}

/// <summary>Builds the TrackView: session weather + every car on the map (with its class: the page colours by class).</summary>
public static class TrackInfo
{
    public static TrackView Build(RaceSnapshot snap, IEnumerable<(CarSnap car, int classPos)> cls, CarSnap focus, TrackMap map)
    {
        var s = snap.Session;
        var v = new TrackView
        {
            Name = s.TrackName, Air = s.AirTemp, Road = s.TrackTemp, Raining = s.Raining, Wetness = s.Wetness, TimeOfDay = s.TimeOfDay, MapVersion = map.Version,
            SessionLength = s.EndEt > 0 ? s.EndEt : -1, Elapsed = s.Et >= 0 ? s.Et : -1,
        };
        foreach (var (c, pos) in cls)
            v.Cars.Add(new MapDot
            {
                F = s.TrackLength > 0 ? Math.Round(Math.Clamp(c.LapDist / s.TrackLength, 0, 1), 4) : 0, X = Math.Round(c.X, 1), Z = Math.Round(c.Z, 1),
                Pos = pos, Me = c == focus, Pit = c.InPits || c.InGarage, Cls = c.Cls,
            });
        return v;
    }
}
