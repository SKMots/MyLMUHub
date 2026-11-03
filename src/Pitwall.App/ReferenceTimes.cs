using System.IO;
using System.Net.Http;

namespace Pitwall.App;

/// <summary>Race Pace reference lap times: the "Laptimes" tab of Ohne Speed's LMU laptimes spreadsheet (per track and class: the alien hotlap and the race-pace
/// times for 100 % .. 107 %), as CSV. Downloaded at most once a day (%AppData%\MyLMUHub\pace\alien-times.csv); without internet the last download is used,
/// else the copy that comes with the app (wwwroot\data\alien-times.csv). The page parses it (pace-ref.js).</summary>
public sealed class ReferenceTimes
{
    const string Url = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTN03UvJDm99byA6vQPZHKOCYVvfxLu1zkJAzdaKyROykzEKY2-Xl1rl1q5znZEf36m88dxMKsY2eaO/pub?gid=1766901750&single=true&output=csv";
    public const string SheetLink = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTN03UvJDm99byA6vQPZHKOCYVvfxLu1zkJAzdaKyROykzEKY2-Xl1rl1q5znZEf36m88dxMKsY2eaO/pubhtml";
    readonly string bundled; readonly SemaphoreSlim gate = new(1, 1);
    static string CachePath => Path.Combine(AppPaths.Dir, "pace", "alien-times.csv");

    public ReferenceTimes(string wwwroot) { bundled = Path.Combine(wwwroot, "data", "alien-times.csv"); }

    /// <summary>{ csv, source: "online" | "saved" | "app", date (of the copy, UTC), link }</summary>
    public async Task<object> Get()
    {
        await gate.WaitAsync();
        try
        {
            var fi = new FileInfo(CachePath);
            if (!fi.Exists || DateTime.UtcNow - fi.LastWriteTimeUtc > TimeSpan.FromDays(1))
            {
                try
                {
                    using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };
                    string csv = await http.GetStringAsync(Url);
                    if (csv.Contains("LMGT3") && csv.Contains("Track"))                   // looks like the sheet (not an error page)
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(CachePath)); await File.WriteAllTextAsync(CachePath, csv);
                        return new { csv, source = "online", date = DateTime.UtcNow, link = SheetLink };
                    }
                }
                catch (Exception) { }
                fi.Refresh();
            }
            if (fi.Exists) return new { csv = await File.ReadAllTextAsync(CachePath), source = "saved", date = fi.LastWriteTimeUtc, link = SheetLink };
            return new { csv = File.Exists(bundled) ? await File.ReadAllTextAsync(bundled) : "", source = "app", date = File.Exists(bundled) ? File.GetLastWriteTimeUtc(bundled) : DateTime.MinValue, link = SheetLink };
        }
        finally { gate.Release(); }
    }
}
