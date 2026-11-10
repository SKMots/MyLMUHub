using System.IO;
using System.Net.Http;
using MyLMUHub.Core;

namespace MyLMUHub.App;

/// <summary>Polls the game's local web API (http://localhost:6397) for what shared memory does not have: the weather forecast (every 10 s), aero / suspension
/// damage (every 2 s, the repair screen) and the track map
/// (once per track, retried every 30 s until it works). Read-only GETs, only while the game has a session. NOT VERIFIED LIVE YET: the last answers are saved to
/// %AppData%\MyLMUHub\webapi\weather.json / trackmap.json so their shape can be checked; Status (shown small in the forecast widget) says what happened.</summary>
public sealed class GameWebApi : IDisposable
{
    readonly HttpClient http = new() { BaseAddress = new Uri("http://localhost:6397/"), Timeout = TimeSpan.FromSeconds(3) };
    readonly CancellationTokenSource cts = new();
    readonly string dumpDir;
    volatile int sessionId = -1;
    volatile string track = ""; volatile bool driving;
    public volatile List<ForecastNode> Nodes;
    public volatile string Status = "waiting for a session";
    /// <summary>The game's map: for which track, and its paths (null = not (yet) available).</summary>
    public volatile string MapTrack;
    public volatile List<double[][]> MapPaths;
    /// <summary>Aero / suspension condition 0..1 of YOUR car (repair screen, DamageParse), -1 = not known.</summary>
    public double Aero = -1, Susp = -1; public double[] SuspWheels;
    /// <summary>The event (race length, fuel / VE limits, the game's laps-per-tank estimate) for the quick race planner; null = not read (yet). Every 60 s in a session.</summary>
    public volatile EventInfo Event;

    public GameWebApi(string appDir) { dumpDir = Path.Combine(appDir, "webapi"); }

    /// <summary>Called by the data pump: the current session (-1 = none, nothing is polled), track, and whether you drive (the repair screen is only read then).</summary>
    public void SetSession(int id, string trackName = "", bool playerDriving = false) { sessionId = id; track = trackName ?? ""; driving = playerDriving; }

    public void Start() => _ = Task.Run(Loop);

    async Task Loop()
    {
        string lastRaw = null, lastRepair = null; DateTime nextMap = DateTime.MinValue, nextWeather = DateTime.MinValue, nextEvent = DateTime.MinValue; int probed = -2, eventSes = -2;
        while (!cts.IsCancellationRequested)
        {
            int ses = sessionId; string tr = track;
            if (ses < 0) { Nodes = null; Status = "waiting for a session"; Aero = -1; Susp = -1; Event = null; }
            else
            {
                if (DateTime.UtcNow >= nextWeather) try                                            // the forecast: every 10 s
                {
                    nextWeather = DateTime.UtcNow.AddSeconds(10);
                    string raw = await http.GetStringAsync("rest/sessions/weather", cts.Token);
                    if (raw != lastRaw) { lastRaw = raw; await Dump("weather.json", raw); }
                    var f = Forecast.Parse(raw, ses);
                    Nodes = f; Status = f == null ? "game API answered, forecast not found (see webapi\\weather.json)" : "";
                }
                catch (OperationCanceledException) when (cts.IsCancellationRequested) { break; }
                catch (Exception ex) { Nodes = null; Status = "game API not reachable: " + ex.GetType().Name; }

                if (!driving) { Aero = -1; Susp = -1; SuspWheels = null; }                       // watching: the repair screen is not your car's
                else try                                                                            // aero / suspension damage (repair screen), every 2 s while you drive
                {
                    string raw = await http.GetStringAsync("rest/garage/UIScreen/RepairAndRefuel", cts.Token);
                    if (raw != lastRepair) { lastRepair = raw; await Dump("repair.json", raw); }
                    var d = DamageParse.ParseAll(raw); Aero = d.Aero; Susp = d.Susp; SuspWheels = d.SuspWheels;
                }
                catch (OperationCanceledException) when (cts.IsCancellationRequested) { break; }
                catch (Exception) { Aero = -1; Susp = -1; SuspWheels = null; }

                if (ses != eventSes || DateTime.UtcNow >= nextEvent)                                // the event: at a new session, then every 60 s
                {
                    eventSes = ses; nextEvent = DateTime.UtcNow.AddSeconds(60);
                    async Task<string> Get(string u) { try { return await http.GetStringAsync(u, cts.Token); } catch (Exception) when (!cts.IsCancellationRequested) { return null; } }
                    string info = await Get("rest/sessions/getSessionsInfoForEvent"), set = await Get("rest/sessions"), garage = await Get("rest/garage/getPlayerGarageData");
                    Event = info == null && set == null && garage == null ? null : EventParse.Parse(info, set, garage);
                }

                if (tr.Length > 0 && MapTrack != tr && DateTime.UtcNow >= nextMap)          // the track map: once per track
                {
                    nextMap = DateTime.UtcNow.AddSeconds(30);
                    try
                    {
                        string raw = await http.GetStringAsync("rest/watch/trackmap", cts.Token);
                        await Dump("trackmap.json", raw);
                        var p = TrackMapParse.Parse(raw);
                        if (p != null) { MapPaths = p; MapTrack = tr; }
                    }
                    catch (OperationCanceledException) when (cts.IsCancellationRequested) { break; }
                    catch (Exception) { }                                                       // not there: the map is learned from driving
                }
            }
            if (ses >= 0 && ses != probed) { probed = ses; await Probe(); }
            try { await Task.Delay(2_000, cts.Token); } catch (OperationCanceledException) { break; }
        }
    }

    // DIAGNOSTIC for the quick race planner: which of these (guessed) game API addresses answer, and with what - race length, VE / fuel limits of the lobby?
    // Once per session, read-only GETs; answers saved to webapi\probe\ (index.txt lists every address and its result). Nothing reads them yet.
    static readonly string[] ProbeUrls = { "rest/sessions", "rest/sessions/settings", "rest/sessions/getSessionsInfoForEvent", "rest/garage/UIScreen/RepairAndRefuel",
                                           "rest/garage/getPlayerGarageData", "rest/race/session", "rest/multiplayer/server/info", "rest/strategy/usage" };
    async Task Probe()
    {
        var index = new System.Text.StringBuilder(DateTime.Now.ToString("s") + " session " + sessionId + "\r\n");
        foreach (var u in ProbeUrls)
        {
            try
            {
                using var r = await http.GetAsync(u, cts.Token); string body = await r.Content.ReadAsStringAsync(cts.Token);
                index.Append(u).Append(" -> ").Append((int)r.StatusCode).Append(", ").Append(body.Length).Append(" chars\r\n");
                if (r.IsSuccessStatusCode && body.Length > 0) await Dump(Path.Combine("probe", u.Replace('/', '_') + ".json"), body);
            }
            catch (OperationCanceledException) when (cts.IsCancellationRequested) { return; }
            catch (Exception ex) { index.Append(u).Append(" -> ").Append(ex.GetType().Name).Append("\r\n"); }
        }
        await Dump(Path.Combine("probe", "index.txt"), index.ToString());
    }

    async Task Dump(string name, string raw)
    {
        try { var f = Path.Combine(dumpDir, name); Directory.CreateDirectory(Path.GetDirectoryName(f)); await File.WriteAllTextAsync(f, raw); } catch (Exception) { }
    }

    public void Dispose() { cts.Cancel(); http.Dispose(); }
}
