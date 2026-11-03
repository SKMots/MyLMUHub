using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32;
using Pitwall.Core;

namespace Pitwall.App;

/// <summary>Race Pace: reads the game's results files (Le Mans Ultimate\UserData\Log\Results\*.xml) in the background and keeps YOUR laps
/// (settings MyNames). Only started when the Race Pace page asks. A cache (%AppData%\MyLMUHub\pace\cache.json) keeps what was read per file,
/// so next time only new files are read. Each cache entry also lists the human drivers of that file: changing your names re-reads only the files they appear in.</summary>
public sealed class PaceService
{
    // RaceKeys: the races in the file (ResultSession.RaceKey), also when none of your laps are in it: the strategy planner joins a race's files with them
    sealed class Entry { public string Key { get; set; } public List<string> Names { get; set; } = new(); public List<PaceSession> Sessions { get; set; } = new(); public List<string> RaceKeys { get; set; } = new(); }
    sealed class Cache { public int Version { get; set; } = 6; public List<string> Names { get; set; } = new(); public Dictionary<string, Entry> Files { get; set; } = new(); }

    static readonly JsonSerializerOptions Opt = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };
    readonly AppSettings settings; readonly object gate = new();
    Cache cache; Task running; int done, total; string error, folder; DateTime lastLook;
    PaceSession live;                                       // the session being driven now (LiveSession), until its results file is read
    FileSystemWatcher watcher; Timer soon;                  // a results file written / changed: read it ~2 s later (no polling of the folder)
    string CachePath => Path.Combine(AppPaths.Dir, "pace", "cache.json");

    public PaceService(AppSettings s) { settings = s; soon = new Timer(_ => { lock (gate) { if (running == null) { lastLook = DateTime.UtcNow; running = Task.Run(Scan); } else soon.Change(2000, Timeout.Infinite); } }); }   // still reading: again in 2 s

    /// <summary>Changes every time the sessions change (a new or changed result file, other names, a live lap): the pages reload only then.</summary>
    public int Generation { get; private set; }

    /// <summary>Guest mode (Guests.cs): a result file written in a guest's time is his. Pages show only the files of whoever drives now (you = no guest).</summary>
    public Guests Guests { get; set; }
    // whose a file is: given to a guest by hand (My sessions page), else by the time it was written (guest mode); null = yours
    string OwnerOf(string file, Entry e)
    {
        if (settings.FileOwners != null && settings.FileOwners.TryGetValue(file, out var g)) return g;
        var p = e.Key?.Split('|'); return Guests != null && p?.Length == 2 && long.TryParse(p[1], out long ticks) ? Guests.OwnerOf(new DateTime(ticks, DateTimeKind.Utc)) : null;
    }
    static long WrittenAt(Entry e) { var p = e.Key?.Split('|'); return p?.Length == 2 && long.TryParse(p[1], out long ticks) ? new DateTimeOffset(new DateTime(ticks, DateTimeKind.Utc)).ToUnixTimeSeconds() : 0; }
    bool Ignored(string file) => settings.IgnoredFiles != null && settings.IgnoredFiles.Contains(file, StringComparer.OrdinalIgnoreCase);
    IEnumerable<PaceSession> Visible(Cache c)
    {
        string who = Guests?.Current;
        return c.Files.Where(kv => !Ignored(kv.Key) && string.Equals(OwnerOf(kv.Key, kv.Value), who, StringComparison.OrdinalIgnoreCase)).SelectMany(kv => kv.Value.Sessions);
    }
    /// <summary>A guest's result files (for the guest panel).</summary>
    public int GuestFiles(string name) { lock (gate) return cache?.Files.Count(kv => string.Equals(OwnerOf(kv.Key, kv.Value), name, StringComparison.OrdinalIgnoreCase)) ?? 0; }
    /// <summary>The files given to this guest by hand (deleted with him).</summary>
    public List<string> HandGiven(string name) { lock (gate) return settings.FileOwners.Where(kv => string.Equals(kv.Value, name, StringComparison.OrdinalIgnoreCase)).Select(kv => kv.Key).ToList(); }

    /// <summary>My sessions page: every result file with laps under your names: { file, time (written, unix s), owner (guest name, null = you), hidden,
    /// sessions: [{ type, track, layout, car, cls, laps, best }] }, newest first.</summary>
    public object Files()
    {
        lock (gate)
        {
            if (cache == null && running == null) { lastLook = DateTime.UtcNow; running = Task.Run(Scan); }
            var list = cache == null ? new List<object>() : cache.Files.Where(kv => kv.Value.Sessions.Count > 0).OrderByDescending(kv => WrittenAt(kv.Value)).Select(kv => (object)new
            {
                file = kv.Key, time = WrittenAt(kv.Value), owner = OwnerOf(kv.Key, kv.Value), hidden = Ignored(kv.Key),
                sessions = kv.Value.Sessions.Select(s => new { type = s.Type, track = s.Track, layout = s.Layout, car = s.Car, cls = s.Class, laps = s.Laps.Count,
                    best = s.Laps.Where(l => l.Length > 5 && l[1] > 0 && ((int)(l[5] ?? 0) & 1) == 0).Select(l => l[1]).DefaultIfEmpty(null).Min() })
            }).ToList();
            return new { scanning = cache == null, guests = settings.Guests.Select(g => g.Name).Distinct(StringComparer.OrdinalIgnoreCase).ToList(), files = list };
        }
    }

    /// <summary>My sessions page: do = hide | restore | guest (name) | mine (back from a guest) | delete (to the Recycle Bin). Returns the files changed.</summary>
    public int Manage(string what, List<string> files, string name)
    {
        string dir = Folder; int n = 0;
        files = (files ?? new()).Where(f => !string.IsNullOrEmpty(f) && f == Path.GetFileName(f) && f.EndsWith(".xml", StringComparison.OrdinalIgnoreCase)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        lock (gate)
        {
            settings.IgnoredFiles ??= new(); settings.FileOwners ??= new();
            foreach (var f in files)
            {
                switch (what)
                {
                    case "hide": if (!Ignored(f)) { settings.IgnoredFiles.Add(f); n++; } break;
                    case "restore": n += settings.IgnoredFiles.RemoveAll(x => string.Equals(x, f, StringComparison.OrdinalIgnoreCase)); break;
                    case "guest":
                        name = (name ?? "").Trim(); if (name.Length == 0 || name.Length > 40) return 0;
                        settings.FileOwners[f] = name; settings.IgnoredFiles.RemoveAll(x => string.Equals(x, f, StringComparison.OrdinalIgnoreCase)); n++;
                        if (!settings.Guests.Any(g => string.Equals(g.Name, name, StringComparison.OrdinalIgnoreCase))) settings.Guests.Add(new GuestPeriod { Name = name });   // a guest with no time of his own
                        break;
                    case "mine": if (settings.FileOwners.Remove(f)) n++; break;
                    case "delete":
                        if (dir == null) break;
                        try
                        {
                            var p = Path.Combine(dir, f);
                            if (File.Exists(p)) Microsoft.VisualBasic.FileIO.FileSystem.DeleteFile(p, Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs, Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);
                            settings.IgnoredFiles.RemoveAll(x => string.Equals(x, f, StringComparison.OrdinalIgnoreCase)); settings.FileOwners.Remove(f); n++;
                        }
                        catch (Exception) { }
                        break;
                }
            }
            SettingsStore.Save(settings);
            Generation++; lastLook = DateTime.MinValue;
        }
        soon.Change(500, Timeout.Infinite);                                                    // deleted files: read the folder again
        return n;
    }
    /// <summary>Guest mode switched / a guest deleted: the live session was the other driver's; read the folder again (deleted files).</summary>
    public void GuestChanged() { lock (gate) { live = null; Generation++; lastLook = DateTime.MinValue; } soon.Change(500, Timeout.Infinite); }
    /// <summary>The results folder (null = not found).</summary>
    public string Folder => folder ?? FindFolder();
    /// <summary>A lap of yours was driven: the live session (LiveSession) as it is now.</summary>
    public void SetLive(PaceSession s) { lock (gate) { live = s; Generation++; } }
    /// <summary>Your latest session on this track from the result files (its layout / setting / game version for the live session); null = none.</summary>
    public PaceSession LastOnTrack(string track)
    {
        lock (gate) return cache == null ? null : Visible(cache).Where(s => PersonalBest.SameTrack(s.Track, track)).OrderBy(s => s.Time).LastOrDefault();
    }
    /// <summary>Your driver names (settings).</summary>
    public List<string> Names => settings.MyNames ?? new();
    /// <summary>All your sessions (null while the first reading of the result files runs: it is started here if needed). For the best-lap widget.</summary>
    public List<PaceSession> Sessions()
    {
        lock (gate)
        {
            if (cache == null && running == null) { lastLook = DateTime.UtcNow; running = Task.Run(Scan); }
            return cache == null ? null : PaceSession.Merge(Visible(cache));   // one race in several files = one session
        }
    }

    /// <summary>The page's data: { folder, scanning, done, total, error, names, candidates, sessions }. Starts a scan when there may be new files (looks at most every 10 s).</summary>
    public object Info(bool withSessions)
    {
        lock (gate)
        {
            // the folder watcher reads new files as they come; without it (not started yet / failed) look again at most every 10 s
            if (running == null && (cache == null || DateTime.UtcNow - lastLook > TimeSpan.FromSeconds(watcher != null ? 300 : 10))) { lastLook = DateTime.UtcNow; running = Task.Run(Scan); }
            bool scanning = running != null && !running.IsCompleted;
            var c = cache;
            var names = settings.MyNames ?? new();
            var sessions = c == null || !withSessions ? new List<PaceSession>() : PaceSession.Merge(Visible(c));
            if (withSessions && live != null) sessions.Add(live);
            var candidates = c == null ? new List<object>() : c.Files.Values.SelectMany(e => e.Names).GroupBy(n => n).OrderByDescending(g => g.Count()).Take(12)
                .Select(g => (object)new { name = g.Key, files = g.Count() }).ToList();
            return new { folder, scanning, done, total, error, names, candidates, sessions, gen = Generation };
        }
    }

    /// <summary>Your car's whole race, every driver's laps (the strategy planner copies its stint pattern): { track, layout, laps: [[n, time, pit 0/1, tyre left %
    /// (null = not in the file), driver]] }; null = no race with your car in that file. A race you left and rejoined is in several files: all of them are used
    /// (the laps from the file with the most, each lap's driver from whichever file's event log saw it).</summary>
    public object CarLaps(string file)
    {
        string dir = folder ?? FindFolder();
        if (dir == null || string.IsNullOrEmpty(file) || file != Path.GetFileName(file) || !file.EndsWith(".xml", StringComparison.OrdinalIgnoreCase)) return null;
        string path = Path.Combine(dir, file);
        if (!File.Exists(path)) return null;
        var names = new HashSet<string>(settings.MyNames ?? new(), StringComparer.OrdinalIgnoreCase);
        foreach (var s in ResultsXml.Parse(path))
        {
            if (s.Type != "Race") continue;
            var car = s.Cars.FirstOrDefault(c => names.Contains(c.Name) || c.Laps.Any(l => names.Contains(l.Driver)));
            if (car == null) continue;
            var drivers = new Dictionary<int, string>(car.LogDrivers);
            var group = new List<string>();
            lock (gate) if (cache != null && s.RaceKey.Length > 0) group = cache.Files.Where(kv => kv.Key != file && kv.Value.RaceKeys.Contains(s.RaceKey)).Select(kv => kv.Key).ToList();
            foreach (var other in group)
            {
                try
                {
                    var os = ResultsXml.Parse(Path.Combine(dir, other)).FirstOrDefault(x => x.RaceKey == s.RaceKey);
                    var oc = os?.Cars.FirstOrDefault(c => c.VehName == car.VehName && c.Team == car.Team);
                    if (oc == null) continue;
                    foreach (var kv in oc.LogDrivers) drivers.TryAdd(kv.Key, kv.Value);
                    if (oc.Laps.Count > car.Laps.Count) car = oc;
                }
                catch (Exception) { }
            }
            // a gap no file logged (the minutes between leaving and rejoining): the same driver before and after it = nobody changed in it
            var known = drivers.Keys.OrderBy(n => n).ToList();
            string Who(ResultLap l)
            {
                if (drivers.TryGetValue(l.N, out var d)) return d;
                int before = known.LastOrDefault(n => n < l.N), after = known.FirstOrDefault(n => n > l.N);
                return before > 0 && after > 0 && drivers[before] == drivers[after] ? drivers[before] : l.Driver;
            }
            return new { track = s.Track, layout = s.Layout, laps = car.Laps.Select(l => new object[] { l.N, l.T, l.Pit ? 1 : 0, l.Wear, Who(l) }) };
        }
        return null;
    }
    /// <summary>New names (and / or results folder): saved in settings.json, then read again.</summary>
    public void Set(List<string> names, string resultsFolder)
    {
        lock (gate)
        {
            if (names != null) settings.MyNames = names.Select(n => n.Trim()).Where(n => n.Length > 0).Distinct().ToList();
            if (resultsFolder != null) settings.ResultsFolder = resultsFolder.Trim();
            SettingsStore.Save(settings);
            lastLook = DateTime.MinValue;
            if (running != null && running.IsCompleted) running = null;
        }
    }

    void Scan()
    {
        try
        {
            error = null; folder = FindFolder();
            if (folder == null) { error = "Results folder not found. Set it on this page (Le Mans Ultimate\\UserData\\Log\\Results)."; return; }
            cache ??= LoadCache();
            Watch(folder);
            var files = Directory.GetFiles(folder, "*.xml");
            if (settings.MyNames == null || settings.MyNames.Count == 0)
            {
                Read(files, new HashSet<string>());                                       // first time: who drives here most? (you)
                settings.MyNames = AutoNames(); SettingsStore.Save(settings);
            }
            if (Read(files, new HashSet<string>(settings.MyNames, StringComparer.OrdinalIgnoreCase))) SaveCache();
        }
        catch (Exception ex) { error = ex.Message; }
        finally { lock (gate) running = null; }
    }

    /// <summary>Reads the files that are new, changed, or have a driver whose name was added / removed. True = something changed.</summary>
    bool Read(string[] files, HashSet<string> names)
    {
        var old = new HashSet<string>(cache.Names, StringComparer.OrdinalIgnoreCase);
        bool same = old.SetEquals(names);
        var changed = same ? new HashSet<string>() : new HashSet<string>(old.Union(names), StringComparer.OrdinalIgnoreCase);
        var next = new Dictionary<string, Entry>();
        var todo = new List<(string Name, string Key, string Path)>();
        foreach (var f in files)
        {
            var fi = new FileInfo(f); string name = fi.Name, key = fi.Length + "|" + fi.LastWriteTimeUtc.Ticks;
            if (cache.Files.TryGetValue(name, out var e) && e.Key == key && (same || !e.Names.Any(changed.Contains))) next[name] = e;
            else todo.Add((name, key, f));
        }
        total = todo.Count; done = 0;
        var results = new System.Collections.Concurrent.ConcurrentDictionary<string, Entry>();
        Parallel.ForEach(todo, new ParallelOptions { MaxDegreeOfParallelism = Math.Max(1, Environment.ProcessorCount / 2) }, t =>
        {
            var e = new Entry { Key = t.Key };
            try
            {
                foreach (var s in ResultsXml.Parse(t.Path))
                {
                    e.Names.AddRange(ResultsXml.Humans(s).Where(n => !e.Names.Contains(n)));
                    e.Sessions.AddRange(PaceSession.Mine(s, names, t.Name));
                    if (s.RaceKey.Length > 0 && !e.RaceKeys.Contains(s.RaceKey)) e.RaceKeys.Add(s.RaceKey);
                }
            }
            catch (Exception) { }                                                         // a file still being written or broken: empty entry, read again when it changes
            results[t.Name] = e; Interlocked.Increment(ref done);
        });
        foreach (var kv in results) next[kv.Key] = kv.Value;
        bool changedAny = !same || todo.Count > 0 || next.Count != cache.Files.Count;
        lock (gate)
        {
            cache = new Cache { Names = names.ToList(), Files = next };
            if (changedAny) Generation++;
            // the live session's own results file has come: it replaces the live one (same track, type and car, and it has the live laps' times)
            if (live != null && results.Values.SelectMany(e => e.Sessions).Any(s => IsLive(s, live))) live = null;
        }
        return changedAny;
    }
    static bool IsLive(PaceSession file, PaceSession lv) =>
        PersonalBest.SameTrack(file.Track, lv.Track) && file.Type == lv.Type && file.Veh == lv.Veh
        && lv.Laps.Count(l => l[1] > 0 && file.Laps.Any(f => f[1] != null && Math.Abs(f[1].Value - l[1].Value) < 0.002)) >= Math.Max(1, lv.Laps.Count(l => l[1] > 0) * 0.8);   // (almost) all live laps in it

    // the results folder: a file written / changed -> read it ~2 s later (the game writes it in one go at the end of a session; a second event restarts the wait)
    void Watch(string dir)
    {
        lock (gate)
        {
            if (watcher != null && string.Equals(watcher.Path, dir, StringComparison.OrdinalIgnoreCase)) return;
            try
            {
                watcher?.Dispose();
                watcher = new FileSystemWatcher(dir, "*.xml") { NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size };
                FileSystemEventHandler on = (_, _) => soon.Change(2000, Timeout.Infinite);
                watcher.Created += on; watcher.Changed += on; watcher.Deleted += on; watcher.Renamed += (_, _) => soon.Change(2000, Timeout.Infinite);
                watcher.EnableRaisingEvents = true;
            }
            catch (Exception) { watcher = null; }
        }
    }

    /// <summary>The name in the most files, plus names in at least 40 % as many files (your other online names).</summary>
    List<string> AutoNames()
    {
        var counts = cache.Files.Values.SelectMany(e => e.Names).GroupBy(n => n).Select(g => (Name: g.Key, N: g.Count())).OrderByDescending(x => x.N).ToList();
        if (counts.Count == 0) return new();
        return counts.Where(x => x.N >= counts[0].N * 0.4).Select(x => x.Name).Take(4).ToList();
    }

    string FindFolder()
    {
        if (!string.IsNullOrWhiteSpace(settings.ResultsFolder)) return Directory.Exists(settings.ResultsFolder) ? settings.ResultsFolder : null;
        foreach (var lib in SteamLibraries())
        {
            var p = Path.Combine(lib, "steamapps", "common", "Le Mans Ultimate", "UserData", "Log", "Results");
            if (Directory.Exists(p)) return p;
        }
        return null;
    }

    static IEnumerable<string> SteamLibraries()
    {
        var list = new List<string>();
        string steam = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Valve\Steam", "SteamPath", null) as string
                       ?? Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath", null) as string;
        if (steam != null)
        {
            list.Add(steam.Replace('/', '\\'));
            try
            {
                var vdf = Path.Combine(steam, "steamapps", "libraryfolders.vdf");
                if (File.Exists(vdf)) foreach (Match m in Regex.Matches(File.ReadAllText(vdf), "\"path\"\\s+\"([^\"]+)\"")) list.Add(m.Groups[1].Value.Replace("\\\\", "\\"));
            }
            catch (Exception) { }
        }
        list.Add(@"C:\Program Files (x86)\Steam");
        return list.Distinct(StringComparer.OrdinalIgnoreCase);
    }

    Cache LoadCache()
    {
        try { if (File.Exists(CachePath)) { var c = JsonSerializer.Deserialize<Cache>(File.ReadAllText(CachePath), Opt); if (c?.Version == 6 && c.Files != null) return c; } }   // 6: laps by the event log (driver who started the lap), race keys (older caches are read again)
        catch (Exception) { }
        return new Cache();
    }

    void SaveCache()
    {
        try { Directory.CreateDirectory(Path.GetDirectoryName(CachePath)); File.WriteAllText(CachePath, JsonSerializer.Serialize(cache, Opt)); } catch (Exception) { }
    }
}
