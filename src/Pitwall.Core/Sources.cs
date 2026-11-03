using System.IO.MemoryMappedFiles;
using System.Text.Json;

namespace Pitwall.Core;

/// <summary>Where snapshots come from: the live game, a saved memory image, or a recorded JSON file.</summary>
public interface ISnapshotSource : IDisposable
{
    string Name { get; }
    /// <summary>The latest snapshot, or null when there is none (game not running / not in a session).</summary>
    RaceSnapshot Read();
}

public sealed class LiveSource : ISnapshotSource
{
    readonly Catalog cat; readonly SnapshotReader reader;
    MemoryMappedFile mmf; MemoryMappedViewAccessor acc; MemView view;
    DateTime nextTry = DateTime.MinValue, nextAlive = DateTime.MinValue;
    public string Name => "live game";
    /// <summary>The game's process: while we hold the shared memory open Windows keeps it (with the last values) after the game has quit, so every 2 s we
    /// check the game still runs and let go of it when not (else the dashboard showed the last moment as if live).</summary>
    const string GameProcess = "Le Mans Ultimate";
    public LiveSource(Catalog catalog) { cat = catalog; reader = new SnapshotReader(catalog); }

    public RaceSnapshot Read()
    {
        if (view == null)
        {
            if (DateTime.UtcNow < nextTry) return null;
            nextTry = DateTime.UtcNow.AddSeconds(2);                      // do not hammer the OS while the game is not running
            try
            {
                mmf = MemoryMappedFile.OpenExisting(cat.MapName, MemoryMappedFileRights.Read);
                acc = mmf.CreateViewAccessor(0, cat.MapSize, MemoryMappedFileAccess.Read);
                view = new AccessorView(acc);
            }
            catch (Exception) { Close(); return null; }
        }
        if (DateTime.UtcNow >= nextAlive)
        {
            nextAlive = DateTime.UtcNow.AddSeconds(2);
            if (!GameRuns()) { Close(); nextTry = DateTime.UtcNow.AddSeconds(2); return null; }
        }
        try { return reader.Read(view); }
        catch (Exception) { Close(); return null; }
    }

    static bool GameRuns()
    {
        var p = System.Diagnostics.Process.GetProcessesByName(GameProcess);
        foreach (var x in p) x.Dispose();
        return p.Length > 0;
    }

    void Close() { try { acc?.Dispose(); } catch { } try { mmf?.Dispose(); } catch { } acc = null; mmf = null; view = null; }
    public void Dispose() => Close();
}

/// <summary>A saved memory image (fixtures/synthetic_dump.bin, made by tools/make_test_dump.py).</summary>
public sealed class ImageFileSource : ISnapshotSource
{
    readonly RaceSnapshot snap;
    public string Name { get; }
    public ImageFileSource(Catalog catalog, string path) { Name = "image " + Path.GetFileName(path); snap = new SnapshotReader(catalog).Read(new BytesView(File.ReadAllBytes(path))); }
    public RaceSnapshot Read() => snap;
    public void Dispose() { }
}

/// <summary>A JSON file with one snapshot or an array of snapshots (played in a loop, one per Read) - see fixtures/golden/*.snapshot.json.</summary>
public sealed class JsonReplaySource : ISnapshotSource
{
    readonly List<RaceSnapshot> frames; int i;
    public string Name { get; }
    public static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };
    public JsonReplaySource(string path)
    {
        Name = "replay " + Path.GetFileName(path);
        string json = File.ReadAllText(path).TrimStart();
        frames = json.StartsWith("[") ? JsonSerializer.Deserialize<List<RaceSnapshot>>(json, Options) : new List<RaceSnapshot> { JsonSerializer.Deserialize<RaceSnapshot>(json, Options) };
    }
    public RaceSnapshot Read() => frames.Count == 0 ? null : frames[i++ % frames.Count];
    public void Dispose() { }
}
