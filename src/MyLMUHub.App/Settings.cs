using System.IO;
using System.Text.Json;
using MyLMUHub.Core;

namespace MyLMUHub.App;

public sealed class WindowPlacement
{
    public double Left { get; set; } = 100;
    public double Top { get; set; } = 100;
    public double Width { get; set; } = 1280;
    public double Height { get; set; } = 720;
    public bool Maximized { get; set; }
    public bool Fullscreen { get; set; }
}

public sealed class AppSettings
{
    /// <summary>Driver names of you and your team-mate as the leaderboard shows them (part of the name is enough). Whoever is driving your car is the highlighted car
    /// while you are not in it. When you are in the car the game flags it itself.</summary>
    public List<string> FocusNames { get; set; } = new() { "YOUR DRIVER NAME", "PARTNER DRIVER NAME" };
    public int Port { get; set; } = 8765;
    /// <summary>The Race Control (dashboard) window.</summary>
    public WindowPlacement Window { get; set; } = new();
    /// <summary>The hub (home / Race Pace) window.</summary>
    public WindowPlacement HubWindow { get; set; } = new() { Width = 1440, Height = 900 };
    /// <summary>Race Pace: your driver names in the results files (empty = found automatically: the name in most files).</summary>
    public List<string> MyNames { get; set; } = new();
    /// <summary>Race Pace: the game's results folder (empty = found through Steam).</summary>
    public string ResultsFolder { get; set; } = "";
    /// <summary>Network access: the pages also on http://&lt;this PC's address&gt;:Port/ for other PCs / tablets at home (LanAccess.cs). Off by default.</summary>
    public bool LanAccess { get; set; }
    /// <summary>Extra Race Control windows, one per view (opened from the NETWORK panel): where each was.</summary>
    public Dictionary<string, WindowPlacement> ViewWindows { get; set; } = new();
    /// <summary>Guest mode (Guests.cs): who else drove on this PC and when. A friend drives under YOUR game account, so his laps carry your name: only the time tells.</summary>
    public List<GuestPeriod> Guests { get; set; } = new();
    /// <summary>My sessions page: result files left out of your data (someone else drove and the app was not on guest mode). Names of files in the results folder.</summary>
    public List<string> IgnoredFiles { get; set; } = new();
    /// <summary>My sessions page: result files given to a guest by hand (file name -> guest name): his, whatever the time.</summary>
    public Dictionary<string, string> FileOwners { get; set; } = new();
}

/// <summary>A guest's time at the wheel: From .. To (unix s; To 0 = guest mode is on now).</summary>
public sealed class GuestPeriod
{
    public string Name { get; set; } = "";
    public long From { get; set; }
    public long To { get; set; }
}

public static class AppPaths
{
    static readonly Lazy<string> dir = new(Init);
    public static string Dir
    {
        get { var d = dir.Value; Directory.CreateDirectory(d); return d; }
    }
    /// <summary>%AppData%\MyLMUHub. The app was called LMU Hub (%AppData%\LMUHub; a dev build briefly used "mylmu") and before that LmuPitwall: the first start under the new name moves the newest
    /// old folder over (settings, layouts, plans, tracks, segments, the Race Pace cache, the page's own storage); if it cannot be moved (a file in use, e.g. an old
    /// copy still running) it is copied (what can be read) and the old one stays.</summary>
    static string Init()
    {
        string root = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), now = Path.Combine(root, "MyLMUHub");
        string old = new[] { "mylmu", "LMUHub", "LmuPitwall" }.Select(n => Path.Combine(root, n)).FirstOrDefault(Directory.Exists);
        if (!Directory.Exists(now) && old != null)
        {
            try { Directory.Move(old, now); }
            catch (Exception) { Copy(old, now); }
        }
        return now;
    }
    static void Copy(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var f in Directory.EnumerateFiles(from)) { try { File.Copy(f, Path.Combine(to, Path.GetFileName(f)), false); } catch (Exception) { } }
        foreach (var d in Directory.EnumerateDirectories(from)) { try { Copy(d, Path.Combine(to, Path.GetFileName(d))); } catch (Exception) { } }
    }
    public static string Settings => Path.Combine(Dir, "settings.json");
    public static string Layout => Path.Combine(Dir, "layout.json");
    public static string Spectate => Path.Combine(Dir, "spectate.json");
    public static string Strategy => Path.Combine(Dir, "strategy.json");      // the strategy planner's plans
    public static string RaceLog => Path.Combine(Dir, "race-live.json");      // the followed car's stints in the current race (StintTracker)
}

/// <summary>Learned track outlines, one file per track (%AppData%\MyLMUHub\tracks\&lt;track&gt;.json), so the map is there straight away next time.</summary>
public static class TrackStore
{
    static string PathFor(string track)
    {
        string safe = string.Concat((track ?? "").Select(ch => Path.GetInvalidFileNameChars().Contains(ch) ? '_' : ch)).Trim();
        return Path.Combine(AppPaths.Dir, "tracks", (safe.Length > 0 ? safe : "unknown") + ".json");
    }
    /// <summary>The saved outline (TrackMap.SaveJson form), null = none.</summary>
    public static string Load(string track)
    {
        try { var p = PathFor(track); if (File.Exists(p)) return File.ReadAllText(p); } catch (Exception) { }
        return null;
    }
    /// <summary>The tracks with a saved outline (their names as the game gives them).</summary>
    public static List<string> Names()
    {
        try { var d = Path.Combine(AppPaths.Dir, "tracks"); return Directory.Exists(d) ? Directory.GetFiles(d, "*.json").Select(f => Path.GetFileNameWithoutExtension(f)).OrderBy(n => n).ToList() : new(); }
        catch (Exception) { return new(); }
    }
    public static void Save(string track, string json)
    {
        try { var p = PathFor(track); Directory.CreateDirectory(Path.GetDirectoryName(p)); File.WriteAllText(p, json); } catch (Exception) { }
    }
}

/// <summary>The spectate picker's choice, kept in its own file (spectate.json) so saving the window placement never overwrites it. No file = automatic.</summary>
public static class SpectateStore
{
    static readonly JsonSerializerOptions Opt = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };

    public static SpectateTarget Load()
    {
        try { if (File.Exists(AppPaths.Spectate)) return JsonSerializer.Deserialize<SpectateTarget>(File.ReadAllText(AppPaths.Spectate), Opt); }
        catch (Exception) { }
        return null;
    }
    public static void Save(SpectateTarget t)
    {
        try { if (t == null) File.Delete(AppPaths.Spectate); else File.WriteAllText(AppPaths.Spectate, JsonSerializer.Serialize(t, Opt)); } catch (Exception) { }
    }
}

public static class SettingsStore
{
    static readonly JsonSerializerOptions Opt = new() { WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };

    public static AppSettings Load()
    {
        try { if (File.Exists(AppPaths.Settings)) return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(AppPaths.Settings), Opt) ?? new AppSettings(); }
        catch (Exception) { /* a broken file must not stop the app: fall back to defaults */ }
        var s = new AppSettings(); Save(s); return s;
    }
    static readonly object Gate = new();
    public static void Save(AppSettings s)
    {
        lock (Gate) { try { File.WriteAllText(AppPaths.Settings, JsonSerializer.Serialize(s, Opt)); } catch (Exception) { } }   // windows and the Race Pace page save from different threads
    }
    public static DateTime Stamp() => File.Exists(AppPaths.Settings) ? File.GetLastWriteTimeUtc(AppPaths.Settings) : DateTime.MinValue;
}
