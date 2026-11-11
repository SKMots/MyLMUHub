using System.Collections.Concurrent;
using System.IO;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using MyLMUHub.Core;

namespace MyLMUHub.App;

/// <summary>Local web server: serves the dashboard page (wwwroot), stores the layout (/api/layout) and pushes the live state to every connected page (/ws).
/// Bound to localhost only. (To show the dashboard on another PC or tablet later: bind to the LAN address, which needs a one-time URL reservation.)</summary>
public sealed class DashServer : IDisposable
{
    HttpListener listener = new();                                                        // replaced when the address changes (Start / SetLan): a refused one cannot be reused
    readonly string wwwroot, layoutPath; readonly int port;
    readonly CancellationTokenSource cts = new();
    readonly ConcurrentDictionary<Guid, Client> clients = new();
    string lastJson = "{\"type\":\"state\",\"standings\":null}";
    string lastMap;                                                                      // the track outline: rare, never dropped, sent to every new page

    sealed class Client { public WebSocket Ws; public readonly SemaphoreSlim Busy = new(1, 1); }

    static readonly Dictionary<string, string> Mime = new(StringComparer.OrdinalIgnoreCase)
    {
        [".html"] = "text/html; charset=utf-8", [".js"] = "text/javascript; charset=utf-8", [".css"] = "text/css; charset=utf-8", [".json"] = "application/json; charset=utf-8",
        [".png"] = "image/png", [".svg"] = "image/svg+xml", [".ico"] = "image/x-icon", [".woff2"] = "font/woff2", [".txt"] = "text/plain; charset=utf-8",
    };

    public DashServer(int port, string wwwroot, string layoutPath)
    {
        this.port = port; this.wwwroot = Path.GetFullPath(wwwroot); this.layoutPath = layoutPath;
    }

    public string Url => $"http://localhost:{port}/";
    /// <summary>A page with the live connection (Race Control) is open.</summary>
    public bool HasClients => !clients.IsEmpty;
    /// <summary>/api/spectate GET: { target, cars } for the picker.</summary>
    public Func<object> SpectateInfo { get; set; }
    /// <summary>/api/spectate PUT { driver, entry }: follow that car; {} = automatic (null).</summary>
    public Action<SpectateTarget> SpectateSet { get; set; }
    /// <summary>/api/pace GET (?light=1 = without the sessions, for the progress): the Race Pace data.</summary>
    public Func<bool, object> PaceInfo { get; set; }
    /// <summary>/api/pace PUT { names, folder }: your driver names / the results folder (null = unchanged).</summary>
    public Action<List<string>, string> PaceSet { get; set; }
    /// <summary>/api/reference GET: the reference lap times sheet (ReferenceTimes).</summary>
    public Func<Task<object>> Reference { get; set; }
    /// <summary>/api/open?what=racecontrol|hub[&amp;view=name] POST: open (or bring to front) that app window; a view = its own extra Race Control window.</summary>
    public Action<string, string> Open { get; set; }
    /// <summary>/api/strategy GET / PUT: the strategy planner's plans (one JSON file).</summary>
    public string StrategyPath { get; set; }
    public string VeGoalsPath { get; set; }
    /// <summary>/api/stints?file= GET: your car's whole race in that results file (PaceService.CarLaps), 404 = none.</summary>
    public Func<string, object> CarLaps { get; set; }
    /// <summary>/api/race-live GET: the session now, the followed car and its race so far (DataPump.RaceLive).</summary>
    public Func<object> RaceLive { get; set; }
    /// <summary>/api/update GET: the app version and update state (UpdateService.Info); POST ?do=check|install.</summary>
    public Func<object> UpdateInfo { get; set; }
    /// <summary>/api/twitch?channel= GET: the viewer count for the Twitch chat widget (TwitchViewers).</summary>
    public Func<string, Task<object>> Twitch { get; set; }
    public Action<string> UpdateDo { get; set; }
    /// <summary>/api/segments GET: your segment times (SegmentStore.Info): the list, or ?key= one track + car.</summary>
    public Func<string, object> Segments { get; set; }
    /// <summary>/api/segments?key=&amp;line= GET: a driving line (SegmentStore.Line), JSON text or null.</summary>
    public Func<string, string, string> SegmentLine { get; set; }
    /// <summary>/api/guest GET: guest mode (Guests.Info); POST ?do=start&amp;name= | stop | delete&amp;name= (this PC only).</summary>
    public Func<object> GuestInfo { get; set; }
    public Action<string, string> GuestDo { get; set; }
    /// <summary>/api/sessions GET: your result files (PaceService.Files); POST { do, files, name } (this PC only): hide / restore / guest / mine / delete.</summary>
    public Func<object> SessionsInfo { get; set; }
    public Func<string, List<string>, string, int> SessionsDo { get; set; }
    /// <summary>/api/coach (this PC only: it uses your API key): GET the AI Coach state, ?id= one saved answer; POST ?do=accept|decline|reset|key|use|models|ask|delete (CoachService).</summary>
    public CoachService Coach { get; set; }
    sealed record CoachBody(string Provider, string Key, string Model);
    sealed record SessionsBody(string Do, List<string> Files, string Name);
    sealed record PaceBody(List<string> Names, string Folder);
    static readonly JsonSerializerOptions Opt = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };

    /// <summary>Takes the port. Once Windows has the network reservation for it (LanAccess.Setup), the local-only address is REFUSED ("access denied"),
    /// so then the network address is taken (it serves this PC too) and requests from other PCs are refused while network access is off.</summary>
    public void Start()
    {
        try { Bind(LanAccess.Prefix(port)); wide = true; }
        catch (HttpListenerException) { Bind($"http://localhost:{port}/"); wide = false; }
    }
    // a new listener on this address (the old one is closed first: the same port), and its accept loop
    void Bind(string prefix)
    {
        try { listener.Close(); } catch (Exception) { }
        var l = new HttpListener(); l.Prefixes.Add(prefix); listener = l;
        l.Start();                                                                       // throws when refused (the caller then binds the other address)
        _ = Task.Run(() => AcceptLoop(l));
    }

    // ---------- network access (LanAccess.cs) ----------
    bool wide;                                                                           // bound to the network address (the reservation exists)
    /// <summary>Other PCs may use the pages now; the last problem ("" = none).</summary>
    public bool LanOn { get; private set; }
    public string LanError { get; private set; } = "";
    /// <summary>Called when network access is switched on / off from a page (the app saves it in settings.json).</summary>
    public Action<bool> LanSaved { get; set; }
    readonly object lanGate = new();
    /// <summary>Switch network access: "" = done, "setup" = Windows needs the one-time permission first, else the error.</summary>
    public string SetLan(bool on)
    {
        lock (lanGate)
        {
            if (!on) { LanOn = false; LanError = ""; return ""; }
            if (!wide)
            {
                // try the network address on a NEW listener while this one keeps serving (this request is answered on it): refused = nothing changes
                var l = new HttpListener(); l.Prefixes.Add(LanAccess.Prefix(port));
                try { l.Start(); }
                catch (HttpListenerException ex)
                {
                    try { l.Close(); } catch (Exception) { }
                    LanError = ex.ErrorCode == 5 ? "Windows has not allowed it yet" : ex.Message;
                    return ex.ErrorCode == 5 ? "setup" : ex.Message;
                }
                var was = listener; listener = l; wide = true; _ = Task.Run(() => AcceptLoop(l));       // moved over; the old one closes once this answer is out
                _ = Task.Delay(1500).ContinueWith(_ => { try { was.Close(); } catch (Exception) { } });
            }
            LanOn = true; LanError = ""; return "";
        }
    }    object NetInfo() => new { on = LanOn, error = LanError, port, urls = LanOn ? LanAccess.Addresses().Select(a => $"http://{a}:{port}/").ToList() : new List<string>() };
    async Task Net(HttpListenerContext ctx)
    {
        if (ctx.Request.HttpMethod == "POST")
        {
            if (!ctx.Request.IsLocal) { await Send(ctx, 403, "text/plain", Encoding.UTF8.GetBytes("only on this PC")); return; }
            string q = ctx.Request.QueryString["do"] ?? "", r = "";
            if (q == "on" || q == "off") { r = SetLan(q == "on"); if (r == "") LanSaved?.Invoke(q == "on"); }
            else if (q == "setup") { r = await Task.Run(() => LanAccess.Setup(port)) ? SetLan(true) : "the admin prompt was refused"; if (r == "") LanSaved?.Invoke(true); }
            await Send(ctx, 200, "application/json; charset=utf-8", JsonSerializer.SerializeToUtf8Bytes(new { result = r, info = NetInfo() }, Opt)); return;
        }
        await Send(ctx, 200, "application/json; charset=utf-8", JsonSerializer.SerializeToUtf8Bytes(NetInfo(), Opt));
    }

    async Task AcceptLoop(HttpListener l)
    {
        while (!cts.IsCancellationRequested && l.IsListening)
        {
            HttpListenerContext ctx;
            try { ctx = await l.GetContextAsync(); } catch (Exception) { break; }
            _ = Task.Run(() => Handle(ctx));
        }
    }

    async Task Handle(HttpListenerContext ctx)
    {
        try
        {
            if (!LanOn && !ctx.Request.IsLocal) { await Send(ctx, 403, "text/plain", Encoding.UTF8.GetBytes("My LMU Hub: network access is off on that PC")); return; }
            string path = ctx.Request.Url.AbsolutePath;
            if (path == "/ws" && ctx.Request.IsWebSocketRequest) { await Socket(ctx); return; }
            if (path == "/api/layout")
            {
                bool put = ctx.Request.HttpMethod == "PUT" || ctx.Request.HttpMethod == "POST";
                await JsonFile(ctx, layoutPath);
                // a page saved the layout file (theme, hotkeys, views): open dashboards read it again; 'by' = the page that saved (it skips its own)
                if (put) { string by = ctx.Request.Headers["X-Page"] ?? ""; var msg = JsonSerializer.Serialize(new { type = "layout", by }); foreach (var c in clients.Values) _ = SendTo(c, msg, true); }
                return;
            }
            if (path == "/api/vegoals" && VeGoalsPath != null) { await JsonFile(ctx, VeGoalsPath); return; }
            if (path == "/api/strategy" && StrategyPath != null) { await JsonFile(ctx, StrategyPath); return; }
            if (path == "/api/race-live" && RaceLive != null) { await Send(ctx, 200, "application/json; charset=utf-8", JsonSerializer.SerializeToUtf8Bytes(RaceLive(), Opt)); return; }
            if (path == "/api/stints" && CarLaps != null) { var r = CarLaps(ctx.Request.QueryString["file"]); await Send(ctx, r == null ? 404 : 200, "application/json; charset=utf-8", r == null ? Encoding.UTF8.GetBytes("{}") : JsonSerializer.SerializeToUtf8Bytes(r, Opt)); return; }
            if (path == "/api/spectate") { await Spectate(ctx); return; }
            if (path == "/api/pace") { await Pace(ctx); return; }
            if (path == "/api/reference" && Reference != null) { await Send(ctx, 200, "application/json; charset=utf-8", JsonSerializer.SerializeToUtf8Bytes(await Reference(), Opt)); return; }
            if (path == "/api/net") { await Net(ctx); return; }
            if (path == "/api/twitch" && Twitch != null) { await Send(ctx, 200, "application/json; charset=utf-8", JsonSerializer.SerializeToUtf8Bytes(await Twitch(ctx.Request.QueryString["channel"]), Opt)); return; }
            bool here = ctx.Request.IsLocal;                                                    // from another PC on the network: no actions on THIS PC
            if (path == "/api/open" && ctx.Request.HttpMethod == "POST" && here) { Open?.Invoke(ctx.Request.QueryString["what"] ?? "", ctx.Request.QueryString["view"] ?? ""); await Send(ctx, 200, "text/plain", Encoding.UTF8.GetBytes("ok")); return; }
            if (path == "/api/sessions" && SessionsInfo != null)
            {
                if (ctx.Request.HttpMethod == "POST")
                {
                    if (!here) { await Send(ctx, 403, "text/plain", Encoding.UTF8.GetBytes("only on the PC the app runs on")); return; }
                    using var ms = new MemoryStream(); await ctx.Request.InputStream.CopyToAsync(ms);
                    SessionsBody b;
                    try { b = ms.Length is > 0 and < 1_000_000 ? JsonSerializer.Deserialize<SessionsBody>(ms.ToArray(), Opt) : null; }
                    catch (Exception) { await Send(ctx, 400, "text/plain", Encoding.UTF8.GetBytes("not json")); return; }
                    int n = b == null ? 0 : SessionsDo?.Invoke(b.Do ?? "", b.Files, b.Name) ?? 0;
                    await Send(ctx, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"changed\":" + n + "}")); return;
                }
                await Send(ctx, 200, "application/json; charset=utf-8", JsonSerializer.SerializeToUtf8Bytes(SessionsInfo(), Opt)); return;
            }
            if (path == "/api/guest" && GuestInfo != null)
            {
                if (ctx.Request.HttpMethod == "POST") { if (!here) { await Send(ctx, 403, "text/plain", Encoding.UTF8.GetBytes("only on the PC the app runs on")); return; } GuestDo?.Invoke(ctx.Request.QueryString["do"] ?? "", ctx.Request.QueryString["name"] ?? ""); }
                await Send(ctx, 200, "application/json; charset=utf-8", JsonSerializer.SerializeToUtf8Bytes(GuestInfo(), Opt)); return;
            }
            if (path == "/api/update" && UpdateInfo != null)
            {
                if (ctx.Request.HttpMethod == "POST" && here) UpdateDo?.Invoke(ctx.Request.QueryString["do"] ?? "");
                await Send(ctx, 200, "application/json; charset=utf-8", JsonSerializer.SerializeToUtf8Bytes(UpdateInfo(), Opt)); return;
            }
            if (path == "/api/tracks")                                                       // the saved game maps (TrackStore): the names, or ?name= one outline
            {
                string n = ctx.Request.QueryString["name"], j = n == null ? JsonSerializer.Serialize(TrackStore.Names()) : TrackStore.Load(n);
                await Send(ctx, j == null ? 404 : 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(j ?? "{}")); return;
            }
            if (path == "/api/coach" && Coach != null) { await CoachApi(ctx, here); return; }
            if (path == "/api/segments" && SegmentLine != null && ctx.Request.QueryString["line"] is string ln)
            { var t = SegmentLine(ctx.Request.QueryString["key"], ln); await Send(ctx, t == null ? 404 : 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(t ?? "{}")); return; }
            if (path == "/api/segments" && Segments != null) { var r = Segments(ctx.Request.QueryString["key"]); await Send(ctx, r == null ? 404 : 200, "application/json; charset=utf-8", r == null ? Encoding.UTF8.GetBytes("{}") : JsonSerializer.SerializeToUtf8Bytes(r, Opt)); return; }
            if (path == "/api/state") { await Send(ctx, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(lastJson)); return; }
            await Static(ctx, path);
        }
        catch (Exception) { try { ctx.Response.Abort(); } catch { } }
    }

    async Task Static(HttpListenerContext ctx, string path)
    {
        string rel = Uri.UnescapeDataString(path.TrimStart('/')); if (rel.Length == 0) rel = "index.html";
        string full = Path.GetFullPath(Path.Combine(wwwroot, rel));
        if (!full.StartsWith(wwwroot, StringComparison.OrdinalIgnoreCase) || !File.Exists(full)) { await Send(ctx, 404, "text/plain", Encoding.UTF8.GetBytes("not found")); return; }   // no path tricks outside wwwroot
        Mime.TryGetValue(Path.GetExtension(full), out string mime);
        ctx.Response.Headers["Cache-Control"] = "no-cache";
        await Send(ctx, 200, mime ?? "application/octet-stream", await File.ReadAllBytesAsync(full));
    }

    /// <summary>GET / PUT a whole JSON file (the layout, the strategy plans).</summary>
    async Task JsonFile(HttpListenerContext ctx, string file)
    {
        if (ctx.Request.HttpMethod == "GET")
        {
            if (!File.Exists(file)) { await Send(ctx, 404, "application/json", Encoding.UTF8.GetBytes("{}")); return; }
            await Send(ctx, 200, "application/json; charset=utf-8", await File.ReadAllBytesAsync(file));
        }
        else if (ctx.Request.HttpMethod == "PUT" || ctx.Request.HttpMethod == "POST")
        {
            using var ms = new MemoryStream(); await ctx.Request.InputStream.CopyToAsync(ms);
            if (ms.Length > 1_000_000) { await Send(ctx, 413, "text/plain", Encoding.UTF8.GetBytes("too big")); return; }
            try { using var _ = JsonDocument.Parse(ms.ToArray()); } catch (Exception) { await Send(ctx, 400, "text/plain", Encoding.UTF8.GetBytes("not json")); return; }
            await File.WriteAllBytesAsync(file, ms.ToArray());
            await Send(ctx, 200, "text/plain", Encoding.UTF8.GetBytes("ok"));
        }
        else await Send(ctx, 405, "text/plain", Encoding.UTF8.GetBytes("method not allowed"));
    }

    async Task Spectate(HttpListenerContext ctx)
    {
        if (ctx.Request.HttpMethod == "GET")
            await Send(ctx, 200, "application/json; charset=utf-8", JsonSerializer.SerializeToUtf8Bytes(SpectateInfo?.Invoke(), Opt));
        else if (ctx.Request.HttpMethod == "PUT" || ctx.Request.HttpMethod == "POST")
        {
            using var ms = new MemoryStream(); await ctx.Request.InputStream.CopyToAsync(ms);
            SpectateTarget t;
            try { t = ms.Length is > 0 and < 10_000 ? JsonSerializer.Deserialize<SpectateTarget>(ms.ToArray(), Opt) : null; }
            catch (Exception) { await Send(ctx, 400, "text/plain", Encoding.UTF8.GetBytes("not json")); return; }
            if (t != null && string.IsNullOrWhiteSpace(t.Driver) && string.IsNullOrWhiteSpace(t.Entry)) t = null;
            SpectateSet?.Invoke(t);
            await Send(ctx, 200, "text/plain", Encoding.UTF8.GetBytes("ok"));
        }
        else await Send(ctx, 405, "text/plain", Encoding.UTF8.GetBytes("method not allowed"));
    }

    async Task CoachApi(HttpListenerContext ctx, bool here)
    {
        const string J = "application/json; charset=utf-8";
        if (!here) { await Send(ctx, 403, "text/plain", Encoding.UTF8.GetBytes("only on the PC the app runs on")); return; }
        var q = ctx.Request.QueryString;
        if (ctx.Request.HttpMethod == "GET")
        {
            object r = q["id"] != null ? Coach.Get(q["id"]) : Coach.Info();
            await Send(ctx, r == null ? 404 : 200, J, r == null ? Encoding.UTF8.GetBytes("{}") : JsonSerializer.SerializeToUtf8Bytes(r, Opt)); return;
        }
        if (ctx.Request.HttpMethod != "POST") { await Send(ctx, 405, "text/plain", Encoding.UTF8.GetBytes("method not allowed")); return; }
        using var ms = new MemoryStream(); await ctx.Request.InputStream.CopyToAsync(ms);
        if (ms.Length > 200_000) { await Send(ctx, 413, "text/plain", Encoding.UTF8.GetBytes("too big")); return; }
        string what = q["do"] ?? ""; object res;
        try
        {
            if (what == "ask") res = await Coach.Ask(JsonSerializer.Deserialize<CoachService.AskBody>(ms.ToArray(), Opt));
            else
            {
                var b = ms.Length > 0 ? JsonSerializer.Deserialize<CoachBody>(ms.ToArray(), Opt) : null;
                string err = "";
                if (what == "accept" || what == "decline") Coach.Accept(what == "accept");
                else if (what == "reset") Coach.Reset();
                else if (what == "delete") Coach.Delete(q["id"] ?? "");
                else if (what == "key") err = Coach.SetKey(b?.Provider ?? "", b?.Key);
                else if (what == "use") err = Coach.Use(b?.Provider ?? "", b?.Model);
                else if (what == "models") { await Send(ctx, 200, J, JsonSerializer.SerializeToUtf8Bytes(await Coach.Models(b?.Provider ?? ""), Opt)); return; }
                else err = "unknown";
                res = err.Length > 0 ? new { error = err } : Coach.Info();
            }
        }
        catch (JsonException) { await Send(ctx, 400, "text/plain", Encoding.UTF8.GetBytes("not json")); return; }
        await Send(ctx, 200, J, JsonSerializer.SerializeToUtf8Bytes(res, Opt));
    }

    async Task Pace(HttpListenerContext ctx)
    {
        if (ctx.Request.HttpMethod == "GET")
            await Send(ctx, 200, "application/json; charset=utf-8", JsonSerializer.SerializeToUtf8Bytes(PaceInfo?.Invoke(ctx.Request.QueryString["light"] != "1"), Opt));
        else if (ctx.Request.HttpMethod == "PUT" || ctx.Request.HttpMethod == "POST")
        {
            using var ms = new MemoryStream(); await ctx.Request.InputStream.CopyToAsync(ms);
            PaceBody b;
            try { b = ms.Length is > 0 and < 10_000 ? JsonSerializer.Deserialize<PaceBody>(ms.ToArray(), Opt) : null; }
            catch (Exception) { await Send(ctx, 400, "text/plain", Encoding.UTF8.GetBytes("not json")); return; }
            if (b != null) PaceSet?.Invoke(b.Names, ctx.Request.IsLocal ? b.Folder : null);         // the results folder only from this PC
            await Send(ctx, 200, "text/plain", Encoding.UTF8.GetBytes("ok"));
        }
        else await Send(ctx, 405, "text/plain", Encoding.UTF8.GetBytes("method not allowed"));
    }

    static async Task Send(HttpListenerContext ctx, int status, string mime, byte[] body)
    {
        ctx.Response.StatusCode = status; ctx.Response.ContentType = mime; ctx.Response.ContentLength64 = body.Length;
        await ctx.Response.OutputStream.WriteAsync(body, 0, body.Length); ctx.Response.Close();
    }

    async Task Socket(HttpListenerContext ctx)
    {
        var wsCtx = await ctx.AcceptWebSocketAsync(null);
        var id = Guid.NewGuid(); var client = new Client { Ws = wsCtx.WebSocket }; clients[id] = client;
        try
        {
            if (lastMap != null) await SendTo(client, lastMap, true);
            await SendTo(client, lastJson, true);                                        // a new page gets the current state straight away
            var buf = new byte[1024];
            while (client.Ws.State == WebSocketState.Open && !cts.IsCancellationRequested)
            {
                var r = await client.Ws.ReceiveAsync(new ArraySegment<byte>(buf), cts.Token);                    // the page sends nothing we need; this notices when it closes
                if (r.MessageType == WebSocketMessageType.Close) break;
            }
        }
        catch (Exception) { }
        finally { clients.TryRemove(id, out _); try { client.Ws.Dispose(); } catch { } }
    }

    async Task SendTo(Client c, string json, bool must = false)
    {
        if (c.Ws.State != WebSocketState.Open) return;
        if (must) await c.Busy.WaitAsync();
        else if (!await c.Busy.WaitAsync(0)) return;                                     // still sending the previous frame: drop this one, the next is newer anyway
        try { await c.Ws.SendAsync(new ArraySegment<byte>(Encoding.UTF8.GetBytes(json)), WebSocketMessageType.Text, true, cts.Token); }
        catch (Exception) { }
        finally { c.Busy.Release(); }
    }

    public void Broadcast(string json)
    {
        lastJson = json;
        foreach (var c in clients.Values) _ = SendTo(c, json);
    }

    public void BroadcastMap(string json)
    {
        lastMap = json;
        foreach (var c in clients.Values) _ = SendTo(c, json, true);
    }

    public void Dispose() { cts.Cancel(); try { listener.Stop(); listener.Close(); } catch { } }
}
