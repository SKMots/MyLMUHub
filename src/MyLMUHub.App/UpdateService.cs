using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace MyLMUHub.App;

/// <summary>Updates from the public GitHub repo's releases (made by release.ps1). Only a release build knows the repo (built in by release.ps1 as assembly
/// metadata "UpdateRepo"); a normal (dev / self-built) build has none and never checks. Checks 15 s after start and every 3 hours; the page
/// (/api/update) shows the button. Install: download the exe next to this one, check size + SHA-256 (in the release text), rename the running exe to
/// .old (Windows allows that), put the new one in its place (keeping this exe's file name), start it (it waits until this one has closed) and close.
/// Up to v1.0.6 the app was "LMU Hub" and updated from the private repo SKMots/LMUHub-Releases with a key; release.ps1 still puts each release there
/// too (asset LMUHub.exe) so those copies find their way here.</summary>
public sealed class UpdateService : IDisposable
{
    const string Asset = "MyLMUHub.exe", OldAsset = "LMUHub.exe";                  // the exe in a release (older releases: LMUHub.exe)
    readonly string repo;
    readonly HttpClient http = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromMinutes(30) };
    readonly Timer timer;
    readonly object gate = new();
    long assetId, assetSize; string sha;

    public string Current { get; }
    public bool Enabled => repo.Length > 0;
    public string State { get; private set; } = "idle";      // off | idle | checking | none | available | downloading | ready | error
    public string Latest { get; private set; } = "";
    public string Notes { get; private set; } = "";
    public string Error { get; private set; } = "";
    public double Progress { get; private set; }             // 0..1 while downloading
    /// <summary>Called (on any thread) once the new exe is in place: close the app.</summary>
    public Action Restart { get; set; }

    public UpdateService()
    {
        var asm = Assembly.GetExecutingAssembly();
        string v = asm.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0";
        Current = v.Split('+')[0];
        repo = asm.GetCustomAttributes<AssemblyMetadataAttribute>().FirstOrDefault(a => a.Key == "UpdateRepo")?.Value ?? "";
        if (!Regex.IsMatch(repo, @"^[\w.-]+/[\w.-]+$")) repo = "";
        if (!Enabled) { State = "off"; return; }
        http.DefaultRequestHeaders.UserAgent.ParseAdd("MyLMUHub/" + Current);
        timer = new Timer(_ => _ = Check(), null, TimeSpan.FromSeconds(15), TimeSpan.FromHours(3));
    }

    public object Info() => new { enabled = Enabled, current = Current, state = State, latest = Latest, notes = Notes, error = Error, progress = Math.Round(Progress, 3) };

    // a public repo: no key (GitHub allows 60 calls an hour per address without one; this makes 2 every 3 hours)
    static HttpRequestMessage Api(string url, string accept = "application/vnd.github+json")
    {
        var m = new HttpRequestMessage(HttpMethod.Get, url);
        m.Headers.Accept.ParseAdd(accept); m.Headers.Add("X-GitHub-Api-Version", "2022-11-28");
        return m;
    }

    public async Task Check()
    {
        if (!Enabled) return;
        lock (gate) { if (State is "checking" or "downloading" or "ready") return; State = "checking"; }
        try
        {
            using var r = await http.SendAsync(Api($"https://api.github.com/repos/{repo}/releases/latest"));
            if (r.StatusCode == HttpStatusCode.NotFound) { State = "none"; return; }       // no release yet
            if (!r.IsSuccessStatusCode) throw new Exception("GitHub answered " + (int)r.StatusCode + (r.StatusCode == HttpStatusCode.Forbidden ? " (too many checks from this address: it tries again later)" : ""));
            using var doc = JsonDocument.Parse(await r.Content.ReadAsStringAsync());
            var root = doc.RootElement;
            string tag = root.GetProperty("tag_name").GetString() ?? "", body = root.TryGetProperty("body", out var b) ? b.GetString() ?? "" : "";
            Latest = tag.TrimStart('v', 'V');
            var m = Regex.Match(body, @"sha256:\s*([0-9a-fA-F]{64})"); sha = m.Success ? m.Groups[1].Value.ToLowerInvariant() : null;
            Notes = Regex.Replace(body, @"\s*sha256:\s*[0-9a-fA-F]{64}\s*", "").Trim();
            assetId = 0;
            foreach (string want in new[] { Asset, OldAsset })
            {
                foreach (var a in root.GetProperty("assets").EnumerateArray())
                    if (string.Equals(a.GetProperty("name").GetString(), want, StringComparison.OrdinalIgnoreCase)) { assetId = a.GetProperty("id").GetInt64(); assetSize = a.GetProperty("size").GetInt64(); }
                if (assetId != 0) break;
            }
            if (Newer(Latest, Current)) Notes = await AllNotes();                               // every version since yours, not only the newest
            Error = "";
            State = assetId != 0 && sha != null && Newer(Latest, Current) ? "available" : "none";
        }
        catch (Exception ex) { Error = ex.Message; State = "error"; }
    }

    /// <summary>The release notes of every version newer than this one, newest first ("v1.0.3: ..."); on a problem: the newest one's (already in Notes).</summary>
    async Task<string> AllNotes()
    {
        try
        {
            using var r = await http.SendAsync(Api($"https://api.github.com/repos/{repo}/releases?per_page=100"));
            if (!r.IsSuccessStatusCode) return Notes;
            using var doc = JsonDocument.Parse(await r.Content.ReadAsStringAsync());
            var list = new List<(Version V, string Text)>();
            foreach (var rel in doc.RootElement.EnumerateArray())
            {
                if (rel.TryGetProperty("draft", out var d) && d.GetBoolean()) continue;
                string tag = (rel.GetProperty("tag_name").GetString() ?? "").TrimStart('v', 'V'), body = rel.TryGetProperty("body", out var b) ? b.GetString() ?? "" : "";
                if (!Version.TryParse(tag, out var v) || !Newer(tag, Current)) continue;
                list.Add((v, "v" + tag + ": " + Regex.Replace(body, @"\s*sha256:\s*[0-9a-fA-F]{64}\s*", "").Trim()));
            }
            return list.Count == 0 ? Notes : string.Join("\n\n", list.OrderByDescending(x => x.V).Select(x => x.Text));
        }
        catch (Exception) { return Notes; }
    }

    public static bool Newer(string a, string b) => Version.TryParse(a, out var x) && Version.TryParse(b, out var y) && x > y;

    /// <summary>Download, check, swap and restart. Runs in the background; State / Progress tell the page how far it is.</summary>
    public void Install()
    {
        lock (gate) { if (State != "available") return; State = "downloading"; Progress = 0; }
        _ = Task.Run(async () =>
        {
            string exe = Environment.ProcessPath, dir = Path.GetDirectoryName(exe), part = exe + ".new";
            try
            {
                // the asset: GitHub answers with a redirect to its file store
                using var first = await http.SendAsync(Api($"https://api.github.com/repos/{repo}/releases/assets/{assetId}", "application/octet-stream"), HttpCompletionOption.ResponseHeadersRead);
                HttpResponseMessage r = first;
                if ((int)first.StatusCode is >= 300 and < 400 && first.Headers.Location != null)
                    r = await http.GetAsync(first.Headers.Location, HttpCompletionOption.ResponseHeadersRead);
                if (!r.IsSuccessStatusCode) throw new Exception("download failed (" + (int)r.StatusCode + ")");
                using (var src = await r.Content.ReadAsStreamAsync())
                using (var dst = File.Create(part))
                using (var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256))
                {
                    var buf = new byte[1 << 16]; long got = 0; int n;
                    while ((n = await src.ReadAsync(buf)) > 0) { await dst.WriteAsync(buf.AsMemory(0, n)); hash.AppendData(buf, 0, n); got += n; Progress = assetSize > 0 ? (double)got / assetSize : 0; }
                    if (got != assetSize) throw new Exception("download incomplete");
                    if (Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant() != sha) throw new Exception("download damaged (checksum)");
                }
                if (r != first) r.Dispose();
                string old = exe + ".old";
                if (File.Exists(old)) File.Delete(old);
                File.Move(exe, old); File.Move(part, exe);
                State = "ready";
                var psi = new ProcessStartInfo(exe) { UseShellExecute = false, WorkingDirectory = dir };            // the same start options, minus an earlier --after-update
                var a = Environment.GetCommandLineArgs().Skip(1).ToList(); int w = a.IndexOf("--after-update"); if (w >= 0) a.RemoveRange(w, Math.Min(2, a.Count - w));
                a.ForEach(psi.ArgumentList.Add); psi.ArgumentList.Add("--after-update"); psi.ArgumentList.Add(Environment.ProcessId.ToString());
                Process.Start(psi);
                Restart?.Invoke();
            }
            catch (Exception ex)
            {
                try { if (File.Exists(part)) File.Delete(part); } catch (Exception) { }
                Error = ex is UnauthorizedAccessException ? "no permission to replace the exe in " + dir + " (move " + Path.GetFileName(exe) + " to a folder of your own, e.g. Documents)" : ex.Message;
                State = "error";
            }
        });
    }

    /// <summary>At start: wait for the previous copy to close (after an update), then remove its old exe.</summary>
    public static void AfterStart(string[] args)
    {
        int i = Array.IndexOf(args, "--after-update");
        if (i >= 0 && i + 1 < args.Length && int.TryParse(args[i + 1], out int pid))
            try { using var p = Process.GetProcessById(pid); p.WaitForExit(20000); } catch (Exception) { }
        string old = Environment.ProcessPath + ".old";
        for (int k = 0; k < 10 && File.Exists(old); k++) { try { File.Delete(old); } catch (Exception) { Thread.Sleep(500); } }
    }

    public void Dispose() { timer?.Dispose(); http.Dispose(); }
}
