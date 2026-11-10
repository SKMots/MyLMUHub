using System.IO;

namespace MyLMUHub.App;

/// <summary>Guest mode: a friend drives on your rig, under YOUR game account (so the game and its result files give his laps your name). While it is on,
/// everything that is driven belongs to him: result files written in his time, his segments (their own folder) and the live session. Your pages then show
/// only his data; without guest mode they never show it. When he has gone: keep his data (hidden from you) or delete it (his result files go to the
/// Recycle Bin, his segments are removed). A result file is written when its session ENDS, so stop guest mode after his last session has ended.</summary>
public sealed class Guests
{
    readonly AppSettings settings; readonly object gate = new();
    public Guests(AppSettings s) { settings = s; settings.Guests ??= new(); settings.FileOwners ??= new(); }

    /// <summary>Guest mode switched on / off, or a guest deleted: the pages and services look again.</summary>
    public event Action Changed;

    static long Now => DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    /// <summary>The guest driving now, null = you.</summary>
    public string Current { get { lock (gate) return settings.Guests.FirstOrDefault(On)?.Name; } }
    // guest mode on now (From 0 = a guest who only has files given to him by hand, never 'on')
    static bool On(GuestPeriod g) => g.From > 0 && g.To == 0;

    /// <summary>Whose is something written at this time (unix s): a guest's name, null = yours.</summary>
    public string OwnerAt(long t)
    {
        lock (gate) return settings.Guests.FirstOrDefault(g => g.From > 0 && t >= g.From && (g.To == 0 || t <= g.To))?.Name;
    }
    public string OwnerOf(DateTime utc) => OwnerAt(new DateTimeOffset(DateTime.SpecifyKind(utc, DateTimeKind.Utc)).ToUnixTimeSeconds());

    public static string Safe(string name) => new string((name ?? "").Trim().Select(ch => char.IsLetterOrDigit(ch) ? ch : '-').ToArray());

    public void Start(string name)
    {
        name = (name ?? "").Trim(); if (name.Length == 0 || name.Length > 40) return;
        lock (gate)
        {
            foreach (var g in settings.Guests.Where(On)) g.To = Now;
            settings.Guests.Add(new GuestPeriod { Name = name, From = Now });
            SettingsStore.Save(settings);
        }
        Changed?.Invoke();
    }

    public void Stop()
    {
        lock (gate) { foreach (var g in settings.Guests.Where(On)) g.To = Now; SettingsStore.Save(settings); }
        Changed?.Invoke();
    }

    /// <summary>Everything of this guest: his result files (written in his time) to the Recycle Bin, his segments folder, his periods. Returns the files moved.</summary>
    public int Delete(string name, string resultsFolder, IEnumerable<string> handGiven = null)
    {
        List<GuestPeriod> his; int moved = 0;
        lock (gate) his = settings.Guests.Where(g => string.Equals(g.Name, name, StringComparison.OrdinalIgnoreCase)).ToList();
        if (his.Count == 0) return 0;
        if (resultsFolder != null && Directory.Exists(resultsFolder))
            foreach (var f in Directory.GetFiles(resultsFolder, "*.xml"))
            {
                long t = new DateTimeOffset(File.GetLastWriteTimeUtc(f)).ToUnixTimeSeconds();
                bool given = handGiven != null && handGiven.Contains(Path.GetFileName(f), StringComparer.OrdinalIgnoreCase);
                if (!given && !his.Any(g => g.From > 0 && t >= g.From && (g.To == 0 || t <= g.To))) continue;
                try { Microsoft.VisualBasic.FileIO.FileSystem.DeleteFile(f, Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs, Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin); moved++; }
                catch (Exception) { }
            }
        try { var d = SegmentStore.GuestDir(name); if (Directory.Exists(d)) Directory.Delete(d, true); } catch (Exception) { }
        lock (gate)
        {
            settings.Guests.RemoveAll(g => his.Contains(g));
            foreach (var k in settings.FileOwners.Where(kv => string.Equals(kv.Value, name, StringComparison.OrdinalIgnoreCase)).Select(kv => kv.Key).ToList()) settings.FileOwners.Remove(k);
            SettingsStore.Save(settings);
        }
        Changed?.Invoke();
        return moved;
    }

    /// <summary>/api/guest: { current, since, guests: [{ name, from, to, periods }] } (newest first).</summary>
    public object Info(Func<string, int> filesOf)
    {
        lock (gate)
        {
            var cur = settings.Guests.FirstOrDefault(On);
            var guests = settings.Guests.GroupBy(g => g.Name, StringComparer.OrdinalIgnoreCase).Select(g => new
            {
                name = g.First().Name, from = g.Where(x => x.From > 0).Select(x => x.From).DefaultIfEmpty(0).Min(), to = g.Any(On) ? 0 : g.Max(x => x.To), periods = g.Count(), files = filesOf?.Invoke(g.First().Name) ?? 0
            }).OrderByDescending(g => g.from).ToList();
            return new { current = cur?.Name, since = cur?.From ?? 0, guests };
        }
    }
}
