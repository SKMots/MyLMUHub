using System.IO;
using System.Net.WebSockets;
using System.Text;
using Pitwall.Core;

namespace Pitwall.App;

/// <summary>Penalty KINDS (drive-through, stop-and-go, +seconds) from the game's UI websocket: ws://127.0.0.1:6398/websocket/ui, subscribe {"messageType":"SUB",
/// "topic":"LiveStandings"} (PenaltyParse). Local, read-only, only while the game has a session; on a failure it tries again after 2 s, doubling up to 60 s.
/// NOT VERIFIED LIVE: the first frame, and then at most one every 30 s, is saved to %AppData%\MyLMUHub\webapi\livestandings.json, and Status says what happened
/// (webapi\livestandings-status.txt). No frame for 15 s: the kinds are dropped (the leaderboard then shows only the count, "PEN").</summary>
public sealed class LivePenalties : IDisposable
{
    const string Url = "ws://127.0.0.1:6398/websocket/ui";
    readonly CancellationTokenSource cts = new();
    readonly string dumpDir;
    volatile bool active;
    volatile Dictionary<string, PenaltyKinds> grid; DateTime gridAt;
    public volatile string Status = "not started";

    public LivePenalties(string appDir) { dumpDir = Path.Combine(appDir, "webapi"); }
    /// <summary>The game has a session (true) or not (false: the socket is closed).</summary>
    public void SetActive(bool on) => active = on;
    public void Start() => _ = Task.Run(Loop);

    /// <summary>The kinds of this driver's penalties, null = not known (no feed, or the driver is not in it).</summary>
    public PenaltyKinds For(string driver)
    {
        var g = grid; if (g == null || (DateTime.UtcNow - gridAt).TotalSeconds > 15) return null;
        return g.TryGetValue(PenaltyParse.Key(driver), out var k) ? k : null;
    }

    async Task Loop()
    {
        int wait = 2000; DateTime nextDump = DateTime.MinValue; string lastStatus = null;
        while (!cts.IsCancellationRequested)
        {
            if (!active) { grid = null; await Pause(2000); continue; }
            try
            {
                using var ws = new ClientWebSocket();
                using (var t = CancellationTokenSource.CreateLinkedTokenSource(cts.Token)) { t.CancelAfter(3000); await ws.ConnectAsync(new Uri(Url), t.Token); }
                await ws.SendAsync(Encoding.UTF8.GetBytes("{\"messageType\":\"SUB\",\"topic\":\"LiveStandings\"}"), WebSocketMessageType.Text, true, cts.Token);
                wait = 2000; Status = "connected, no standings yet"; int frames = 0;
                var buf = new byte[64 * 1024]; var ms = new MemoryStream();
                while (active && ws.State == WebSocketState.Open && !cts.IsCancellationRequested)
                {
                    ms.SetLength(0); WebSocketReceiveResult r;
                    do { r = await ws.ReceiveAsync(buf, cts.Token); if (r.MessageType == WebSocketMessageType.Close) break; ms.Write(buf, 0, r.Count); } while (!r.EndOfMessage && ms.Length < 8_000_000);
                    if (r.MessageType == WebSocketMessageType.Close) break;
                    if (r.MessageType != WebSocketMessageType.Text) continue;
                    string text = Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)ms.Length); frames++;
                    if (DateTime.UtcNow >= nextDump) { nextDump = DateTime.UtcNow.AddSeconds(30); await Dump("livestandings.json", text); }
                    var g = PenaltyParse.Parse(text);
                    if (g != null) { grid = g; gridAt = DateTime.UtcNow; Status = "ok: " + g.Count + " drivers, " + g.Values.Count(k => k.DriveThrough + k.StopGo > 0 || k.Seconds > 0) + " with a penalty"; }
                    else if (grid == null) Status = "connected, " + frames + " messages, no standings found in them (see livestandings.json)";
                    if (Status != lastStatus) { lastStatus = Status; await Dump("livestandings-status.txt", DateTime.Now.ToString("s") + " " + Status); }
                }
                try { if (ws.State == WebSocketState.Open) await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None); } catch (Exception) { }
            }
            catch (OperationCanceledException) when (cts.IsCancellationRequested) { break; }
            catch (Exception ex) { Status = "not reachable: " + ex.GetType().Name; }
            grid = null;
            if (Status != lastStatus) { lastStatus = Status; await Dump("livestandings-status.txt", DateTime.Now.ToString("s") + " " + Status); }
            await Pause(wait); wait = Math.Min(wait * 2, 60_000);
        }
    }

    async Task Pause(int ms) { try { await Task.Delay(ms, cts.Token); } catch (OperationCanceledException) { } }
    async Task Dump(string name, string text)
    {
        try { Directory.CreateDirectory(dumpDir); await File.WriteAllTextAsync(Path.Combine(dumpDir, name), text); } catch (Exception) { }
    }
    public void Dispose() { cts.Cancel(); }
}
