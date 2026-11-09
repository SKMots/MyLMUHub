using System.IO;
using System.Text.Json;
using Pitwall.Core;

namespace Pitwall.App;

/// <summary>Reads the game 10 times a second, builds the standings and pushes them to the page. Focus names are re-read when settings.json changes.
/// The learned track outline goes out as its own message ({type:"map"}) only when it changes; it is saved per track once complete.</summary>
public sealed class DataPump : IDisposable
{
    readonly ISnapshotSource source; readonly StandingsEngine engine; readonly DashServer server; readonly Func<List<string>> getFocusNames; readonly GameWebApi web;
    readonly CancellationTokenSource cts = new();
    static readonly JsonSerializerOptions Opt = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, Converters = { new Round3() } };
    /// <summary>Numbers go to the page with 3 decimals (lap times to the millisecond; more is noise): a smaller message, and "nothing changed" is seen more often.</summary>
    sealed class Round3 : System.Text.Json.Serialization.JsonConverter<double>
    {
        public override double Read(ref Utf8JsonReader r, Type t, JsonSerializerOptions o) => r.GetDouble();
        public override void Write(Utf8JsonWriter w, double v, JsonSerializerOptions o) { if (double.IsFinite(v)) w.WriteNumberValue(Math.Round(v, 3)); else w.WriteNullValue(); }
    }
    public string LastError { get; private set; } = "";
    volatile RaceSnapshot lastSnap;
    string loadedTrack; bool trackSaved; int mapVersion = -1;
    readonly StintTracker stints = new(LoadLog()); readonly object stintGate = new();
    /// <summary>Your result files (Race Pace) for the best-lap widget; null = no widget data.</summary>
    public PaceService Pace { get; set; }
    readonly PersonalBest best = new(); readonly LiveSession liveSession = new(); readonly SegmentRecorder segRec = new();
    /// <summary>Where your segment times are kept (Untapped potential page); null = not recorded.</summary>
    /// <summary>Penalty kinds from the game's UI websocket (live only), joined to the leaderboard rows by driver name.</summary>
    public LivePenalties Penalties { get; set; }
    public SegmentStore Segments { get; set; } string bestKey; int bestGen = -1; List<PaceSession> bestList; DateTime bestLook;

    /// <summary>For the spectate picker: every car of the last reading, in overall order.</summary>
    public object Cars()
    {
        var s = lastSnap;
        if (s == null) return Array.Empty<object>();
        return s.Cars.OrderBy(c => c.Place).Select(c => new { c.Driver, c.Entry, c.Cls, c.Place, Player = c.IsPlayer }).ToList();
    }

    public DataPump(ISnapshotSource source, StandingsEngine engine, DashServer server, Func<List<string>> getFocusNames, GameWebApi web = null)
    { this.source = source; this.engine = engine; this.server = server; this.getFocusNames = getFocusNames; this.web = web; }

    public void Start() => _ = Task.Run(Loop);

    // the kind of each car's penalties (DT / SG / +s) when the websocket gives it; the count stays from shared memory
    void JoinPenaltyKinds(StandingsView st)
    {
        if (Penalties == null || st == null) return;
        void Set(List<StandingRow> rows) { if (rows == null) return; foreach (var r in rows) { var k = Penalties.For(r.Driver); if (k != null) { r.PenDt = k.DriveThrough; r.PenSg = k.StopGo; r.PenSec = k.Seconds; } } }
        Set(st.Rows); Set(st.All); if (st.Others != null) foreach (var o in st.Others) Set(o.Rows);
    }

    async Task Loop()
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(100));
        string last = null; int tick = 0;
        try
        {
            while (await timer.WaitForNextTickAsync(cts.Token))
            {
                if (!server.HasClients && tick++ % 10 != 0) continue;                    // no Race Control open: once a second is enough (the hub's home page polls every 3 s)
                try
                {
                    var snap = source.Read(); lastSnap = snap;
                    web?.SetSession(snap?.Session.SessionId ?? -1, snap?.Session.TrackName, snap?.Cars.Any(c => c.IsPlayer) ?? false);
                    Penalties?.SetActive(snap != null && snap.Session.SessionId >= 0);
                    string json;
                    if (snap == null) json = "{\"type\":\"state\",\"standings\":null,\"top\":null,\"car\":null,\"track\":null,\"forecast\":null}";
                    else
                    {
                        engine.FocusNames = getFocusNames();
                        var standings = engine.Build(snap);
                        JoinPenaltyKinds(standings);
                        if (web != null && engine.FocusCar != null && engine.FocusCar.IsPlayer) { engine.Car.Aero = web.Aero; engine.Car.Susp = web.Susp; engine.Car.SuspWheels = web.SuspWheels; }   // the repair screen is YOUR car: not while watching
                        if (web != null) { DamageDiag(engine.FocusCar); FlagDiag(snap); }
                        if (web != null)                                                         // live only: a replay must not overwrite the saved race
                        {
                            lock (stintGate) stints.Update(snap, engine.FocusCar, DateTimeOffset.Now.ToUnixTimeMilliseconds());
                            if (stints.Changed) { stints.Changed = false; SaveLog(); }
                        }
                        Map();
                        var pb = BestLap(snap, engine.FocusCar);
                        var forecast = web == null ? null : new { nodes = web.Nodes, status = web.Status };
                        json = JsonSerializer.Serialize(new { type = "state", standings, top = engine.Top, car = engine.Car, track = engine.Track, forecast, pb, rel = engine.Rel, pred = engine.Pred }, Opt);
                    }
                    if (json != last) { server.Broadcast(json); last = json; }              // nothing changed: nothing is sent
                    LastError = "";
                }
                catch (Exception ex) { LastError = ex.Message; }
            }
        }
        catch (OperationCanceledException) { }
    }

    // a new track: take its saved outline if there is one; the game's own map wins over a learned one; a newly completed outline is saved; a changed one is sent
    void Map()
    {
        var map = engine.Map;
        if (map.Track != loadedTrack)
        {
            loadedTrack = map.Track; trackSaved = false;
            var saved = TrackStore.Load(map.Track);
            if (saved != null && map.LoadSaved(map.Track, saved)) trackSaved = true;
        }
        if (web != null && map.Source != "game" && web.MapPaths != null && web.MapTrack == map.Track && map.Track.Length > 0) { map.LoadGame(map.Track, web.MapPaths); trackSaved = false; }
        if (map.Complete && !trackSaved && map.Track.Length > 0) { TrackStore.Save(map.Track, map.SaveJson()); trackSaved = true; }
        if (map.Version != mapVersion)
        {
            mapVersion = map.Version;
            server.BroadcastMap(JsonSerializer.Serialize(new { type = "map", track = map.Track, version = map.Version, complete = map.Complete, source = map.Source, paths = map.Paths() }, Opt));
        }
    }

    /// <summary>/api/race-live: the session now (numbers), the followed car and its race so far (StintTracker). The strategy page polls it while open.</summary>
    public object RaceLive()
    {
        var s = lastSnap; RaceLog log; var f = engine.FocusCar;
        lock (stintGate) log = stints.Log == null ? null : JsonSerializer.Deserialize<RaceLog>(JsonSerializer.Serialize(stints.Log));   // a copy: the pump keeps changing it
        var car = s == null || log == null || log.Slot < 0 ? f : s.Cars.FirstOrDefault(c => c.Slot == log.Slot) ?? f;
        return new
        {
            clock = DateTimeOffset.Now.ToUnixTimeMilliseconds(),
            session = s == null ? null : new { id = s.Session.SessionId, phase = s.Session.GamePhase, et = s.Session.Et, endEt = s.Session.EndEt, maxLaps = s.Session.MaxLaps, track = s.Session.TrackName },
            car = s == null || car == null ? null : new { driver = car.Driver, entry = car.Entry, cls = car.Cls, laps = car.Laps, inPits = car.InPits || car.InGarage, ve = car.Ve, last = car.Last, best = car.Best, est = car.EstLap,
                fuel = car.Detail?.Fuel ?? -1, fuelCap = car.Detail?.FuelCap ?? -1,
                veUse = car == f ? engine.Car.Ve.Avg : -1, fuelUse = car == f ? engine.Car.Fuel.Avg : -1 },   // per lap, 5-lap average (the followed car only)
            log,
            @event = web?.Event,                                                                 // race length, fuel / VE limits (quick race planner)
        };
    }

    // DIAGNOSTIC (damage widget not right yet): what the game reports for the followed car, written to webapi\damage-live.json only when it changes,
    // plus a history of the last 50 changes, so a session can be checked afterwards. Dent zones 0..7 (0 none, 1 light, 2 heavy), detached, the condition shown.
    string lastDamage; readonly Queue<string> damageHist = new();
    // DIAGNOSTIC (owner: the yellow on the map lit the whole track): the game's raw flag values and what the map made of them, a line each time they change
    // (the last 100), in webapilags-live.txt
    string lastFlags; readonly Queue<string> flagHist = new();
    void FlagDiag(RaceSnapshot snap)
    {
        var s = snap.Session; var f = engine.Track?.Flags;
        string now = "sectorFlag[0..2]=" + (s.SectorFlagRaw == null ? "-" : string.Join(",", s.SectorFlagRaw)) + " yellowState=" + s.YellowState + " phase=" + s.GamePhase +
                     " -> " + (f == null ? "-" : f.State + " S" + string.Join("", f.Sectors) + " incidents=" + f.Incidents + " zones=" + f.Zones.Count + (f.Diag.Length > 0 ? " [" + f.Diag + "]" : ""));
        if (now == lastFlags) return;
        lastFlags = now; flagHist.Enqueue(DateTime.Now.ToString("HH:mm:ss") + " " + now); while (flagHist.Count > 100) flagHist.Dequeue();
        try { var dir = Path.Combine(AppPaths.Dir, "webapi"); Directory.CreateDirectory(dir); File.WriteAllLines(Path.Combine(dir, "flags-live.txt"), flagHist); } catch (Exception) { }
    }

    void DamageDiag(CarSnap f)
    {
        if (f?.Detail == null) return;
        var c = engine.Car;
        string now = JsonSerializer.Serialize(new { f.Driver, player = f.IsPlayer, dents = f.Detail.Dents, detached = f.Detail.Detached,
            wheels = f.Detail.Wheels.Select(w => new { w.Flat, w.Detached }), body = c.Body, aero = c.Aero, susp = c.Susp, webAero = web?.Aero, webSusp = web?.Susp });
        if (now == lastDamage) return;
        lastDamage = now; damageHist.Enqueue(DateTime.Now.ToString("HH:mm:ss") + " " + now); while (damageHist.Count > 50) damageHist.Dequeue();
        try { var dir = Path.Combine(AppPaths.Dir, "webapi"); Directory.CreateDirectory(dir); File.WriteAllLines(Path.Combine(dir, "damage-live.txt"), damageHist); } catch (Exception) { }
    }

    // the best-lap widget: your laps live (only under your names) + your result files on this track with this car (looked up again when the track,
    // the car or the files change; the files at most every 5 s while they are still being read)
    PbView BestLap(RaceSnapshot snap, CarSnap f)
    {
        if (Pace == null || f == null) return null;
        best.Update(snap, f, Pace.Names);
        if (liveSession.Update(snap, f, Pace.Names, Pace.LastOnTrack)) Pace.SetLive(liveSession.Current);   // Race Pace / Home show this session before its results file exists
        if (Segments != null && f.IsPlayer && Pace.Names.Any(n => string.Equals(n, f.Driver, StringComparison.OrdinalIgnoreCase)))   // segment times: your own laps only
        {
            var lap = segRec.Update(snap, f);
            if (lap != null) Segments.Add(snap.Session.TrackName, f.Model.Length > 0 ? f.Model : f.Entry, f.Cls, segRec, lap);
        }
        string track = snap.Session.TrackName, cls = f.Cls, car = f.Model.Length > 0 ? f.Model : f.Entry, key = track + "|" + cls;
        if (key != bestKey || (Pace.Generation != bestGen && DateTime.UtcNow - bestLook > TimeSpan.FromSeconds(5)))
        {
            bestLook = DateTime.UtcNow; var all = Pace.Sessions(); bestKey = key; bestGen = Pace.Generation;
            bestList = all?.Where(s => PersonalBest.SameTrack(s.Track, track) && PersonalBest.SameClass(s.Class, cls)).ToList();
            if (all == null) bestKey = null;                                                // still reading: look again
        }
        return best.View(bestList, track, cls, car);
    }

    static RaceLog LoadLog()
    {
        try { return File.Exists(AppPaths.RaceLog) ? JsonSerializer.Deserialize<RaceLog>(File.ReadAllText(AppPaths.RaceLog)) : null; } catch (Exception) { return null; }
    }
    void SaveLog()
    {
        try { string j; lock (stintGate) j = JsonSerializer.Serialize(stints.Log); File.WriteAllText(AppPaths.RaceLog, j); } catch (Exception) { }
    }

    public void Dispose() { cts.Cancel(); source.Dispose(); web?.Dispose(); }
}
