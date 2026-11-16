using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace MyLMUHub.Server;

/// <summary>My LMU Hub team server. One small JSON API, nothing else: no web pages yet, no file uploads, no admin panel on the internet.
/// Safety (owner 2026-11-16: a public app, invited members are not trusted):
///  - every request but setup / join needs a member key; a member only sees and changes the teams they are in, and only what their role allows;
///  - requests: JSON only, at most 64 KB, only the known fields (an unknown one = refused), every value checked (Requests.cs) and stored as the server
///    rebuilt it; nothing is run, opened or written as a file;
///  - rate limits per member and per address (joining: a few tries a minute, so invite codes cannot be guessed);
///  - answers carry headers that stop a browser from running or framing anything from here; errors say nothing about the inside.
/// Run in Docker behind a Cloudflare tunnel (docker-compose.yml: no open ports, read-only, not root).</summary>
public static class Server
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow, MaxDepth = 8, NumberHandling = JsonNumberHandling.Strict,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never
    };

    public static void Main(string[] args)
    {
        var data = Environment.GetEnvironmentVariable("MLH_DATA") ?? "/data";
        Build(args, data, Environment.GetEnvironmentVariable("MLH_SETUP_KEY")).Run();
    }

    /// <summary>The server (tests: their own data folder and setup key, any address).</summary>
    public static WebApplication Build(string[] args, string dataDir, string setupKey, string urls = null)
    {
        var b = WebApplication.CreateBuilder(new WebApplicationOptions { Args = args, EnvironmentName = "Production", ContentRootPath = AppContext.BaseDirectory, WebRootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot") });
        if (urls != null) b.WebHost.UseUrls(urls);
        b.WebHost.ConfigureKestrel(k =>
        {
            k.AddServerHeader = false;
            k.Limits.MaxRequestBodySize = 256 * 1024;                                       // a 24 h race with every lap: ~60 KB
            k.Limits.MaxRequestHeadersTotalSize = 16 * 1024;
            k.Limits.MaxRequestLineSize = 4 * 1024;
            k.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(15);
        });
        b.Logging.ClearProviders(); b.Logging.AddSimpleConsole(o => { o.SingleLine = true; o.TimestampFormat = "yyyy-MM-dd HH:mm:ss "; });
        b.Logging.SetMinimumLevel(LogLevel.Warning); b.Logging.AddFilter("MyLMUHub", LogLevel.Information);
        b.Services.ConfigureHttpJsonOptions(o =>
        {
            o.SerializerOptions.UnmappedMemberHandling = Json.UnmappedMemberHandling; o.SerializerOptions.MaxDepth = Json.MaxDepth; o.SerializerOptions.NumberHandling = Json.NumberHandling;
        });
        b.Services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = 429;
            // everyone: 120 requests a minute per member key (else per address)
            o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx => RateLimitPartition.GetFixedWindowLimiter(Auth.KeyOf(ctx.Request) is string k ? "k" + Auth.Hash(k) : "a" + Address(ctx),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 120, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
            // setup / join (no key yet): 5 tries a minute per address
            o.AddPolicy("join", ctx => RateLimitPartition.GetFixedWindowLimiter("j" + Address(ctx), _ => new FixedWindowRateLimiterOptions { PermitLimit = 5, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
            // sending race results: 20 a minute per member
            o.AddPolicy("upload", ctx => RateLimitPartition.GetFixedWindowLimiter("u" + (Auth.KeyOf(ctx.Request) ?? Address(ctx)), _ => new FixedWindowRateLimiterOptions { PermitLimit = 20, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
        });

        var store = new Store(Path.Combine(dataDir, "team.db"));
        var app = b.Build();
        var log = app.Logger;

        // no member yet: the server owner makes the first account with the setup key (from MLH_SETUP_KEY, else a new one shown once in the log)
        if (!store.AnyUser() && string.IsNullOrEmpty(setupKey))
        {
            setupKey = Auth.NewCode();
            log.LogWarning("No accounts yet. Setup key (use it once in My LMU Hub > Team > Set up this server): {key}", setupKey);
        }

        app.UseExceptionHandler(e => e.Run(ctx => { ctx.Response.StatusCode = 500; return ctx.Response.WriteAsJsonAsync(new { error = "server error" }); }));
        app.Use(async (ctx, next) =>
        {
            var h = ctx.Response.Headers;
            h.XContentTypeOptions = "nosniff"; h.XFrameOptions = "DENY"; h.CacheControl = "no-store";
            h["Referrer-Policy"] = "no-referrer";
            // the API: nothing may run; the website's pages: only this site's own files (no inline script, nothing from elsewhere)
            h.ContentSecurityPolicy = ctx.Request.Path.StartsWithSegments("/api") ? "default-src 'none'; frame-ancestors 'none'"
                : "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
            h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
            // a body must be JSON (nothing else is read)
            if (ctx.Request.ContentLength > 0 && !(ctx.Request.ContentType ?? "").StartsWith("application/json", StringComparison.OrdinalIgnoreCase)) { ctx.Response.StatusCode = 415; return; }
            await next();
        });
        app.UseRateLimiter();
        app.UseDefaultFiles(); app.UseStaticFiles();                                         // the website (wwwroot): / and /app/

        IResult Err(int code, string why) => Results.Json(new { error = why }, statusCode: code);
        // the desktop app: its member key (anything its role allows); a phone / browser: its login cookie, for READING only (GET)
        User KeyUser(HttpContext ctx) => store.UserByKey(Auth.KeyOf(ctx.Request));
        User Me(HttpContext ctx) => KeyUser(ctx) ?? (HttpMethods.IsGet(ctx.Request.Method) ? store.UserBySession(ctx.Request.Cookies[Web.Cookie]) : null);

        app.MapGet("/api/v1/health", () => Results.Json(new { ok = true, version = 1, setup = !store.AnyUser() }));

        // ---- accounts ----
        app.MapPost("/api/v1/setup", (SetupReq r) =>
        {
            if (store.AnyUser() || string.IsNullOrEmpty(setupKey)) return Err(403, "already set up");
            if (r == null || !string.Equals(Auth.NormCode(r.SetupKey) ?? r.SetupKey, Auth.NormCode(setupKey) ?? setupKey, StringComparison.Ordinal)) return Err(403, "wrong setup key");
            var name = Check.Text(r.Name, 40); if (name == null) return Err(400, "name");
            var key = Auth.NewKey(); store.AddUser(name, key, true); setupKey = null;
            log.LogInformation("Server owner account made: {name}", name);
            return Results.Json(new { key });
        }).RequireRateLimiting("join");

        app.MapPost("/api/v1/join", (HttpContext ctx, JoinReq r) =>
        {
            var me = Me(ctx);
            var name = me?.Name ?? Check.Text(r?.Name, 40); if (name == null) return Err(400, "name");
            var got = store.Redeem(r?.Code, me?.Id, name);
            if (got == null) return Err(404, "unknown, used or expired code");
            log.LogInformation("{name} joined team {team}", name, got.Value.Team);
            return Results.Json(new { key = got.Value.Key, team = got.Value.Team });   // key: only for a new member (keep it: it is the login)
        }).RequireRateLimiting("join");

        app.MapGet("/api/v1/me", (HttpContext ctx) =>
        {
            var me = Me(ctx); if (me == null) return Err(401, "no key");
            return Results.Json(new { id = me.Id, name = me.Name, admin = me.Admin, discord = store.DiscordName(me.Id), phones = store.Sessions(me.Id),
                teams = store.TeamsOf(me.Id).Select(t => new { id = t.Id, name = t.Name, roles = Check.Words(t.Roles) }) });
        });
        app.MapPost("/api/v1/me/name", (HttpContext ctx, NameReq r) =>
        {
            var me = Me(ctx); if (me == null) return Err(401, "no key");
            var name = Check.Text(r?.Name, 40); if (name == null) return Err(400, "name");
            store.Rename(me.Id, name); return Results.Json(new { ok = true });
        });
        app.MapPost("/api/v1/me/newkey", (HttpContext ctx) =>
        {
            var me = Me(ctx); if (me == null) return Err(401, "no key");
            return Results.Json(new { key = store.NewKeyFor(me.Id) });                    // the old key stops working
        });

        // ---- teams (made by the server owner) ----
        app.MapPost("/api/v1/teams", (HttpContext ctx, NameReq r) =>
        {
            var me = Me(ctx); if (me == null) return Err(401, "no key"); if (!me.Admin) return Err(403, "only the server owner makes teams");
            var name = Check.Text(r?.Name, 40); if (name == null) return Err(400, "name");
            return Results.Json(new { id = store.AddTeam(name, me.Id) });
        });
        app.MapGet("/api/v1/teams/{team:long}/members", (HttpContext ctx, long team) =>
        {
            var me = Me(ctx); if (me == null) return Err(401, "no key"); if (store.RolesIn(team, me.Id) == Role.None) return Err(404, "no such team");
            return Results.Json(store.Members(team).Select(m => new { id = m.UserId, name = m.Name, roles = Check.Words(m.Roles), joined = m.Joined, me = m.UserId == me.Id }));
        });
        app.MapPost("/api/v1/teams/{team:long}/invites", (HttpContext ctx, long team, InviteReq r) =>
        {
            var me = Me(ctx); if (me == null) return Err(401, "no key");
            var mine = store.RolesIn(team, me.Id); if (mine == Role.None) return Err(404, "no such team"); if (!mine.HasFlag(Role.Owner)) return Err(403, "only the team owner invites");
            var roles = Check.Roles(r?.Roles); if (roles == null) return Err(400, "roles");
            if (r.Days is < 1 or > 30) return Err(400, "days");
            return Results.Json(new { code = store.AddInvite(team, roles.Value, r.Days, me.Id), days = r.Days });
        });
        app.MapPost("/api/v1/teams/{team:long}/members/{user:long}/roles", (HttpContext ctx, long team, long user, RolesReq r) =>
        {
            var me = Me(ctx); if (me == null) return Err(401, "no key");
            var mine = store.RolesIn(team, me.Id); if (mine == Role.None) return Err(404, "no such team"); if (!mine.HasFlag(Role.Owner)) return Err(403, "only the team owner");
            var roles = Check.Roles(r?.Roles); if (roles == null) return Err(400, "roles");
            if (!roles.Value.HasFlag(Role.Owner) && store.RolesIn(team, user).HasFlag(Role.Owner) && store.Owners(team) <= 1) return Err(409, "a team keeps at least one owner");
            return store.SetRoles(team, user, roles.Value) ? Results.Json(new { ok = true }) : Err(404, "no such member");
        });
        // leave (yourself) or remove (the team owner): personal data goes, the team's race results stay
        app.MapDelete("/api/v1/teams/{team:long}/members/{user:long}", (HttpContext ctx, long team, long user) =>
        {
            var me = Me(ctx); if (me == null) return Err(401, "no key");
            var mine = store.RolesIn(team, me.Id); if (mine == Role.None) return Err(404, "no such team");
            if (user != me.Id && !mine.HasFlag(Role.Owner)) return Err(403, "only the team owner removes others");
            if (store.RolesIn(team, user).HasFlag(Role.Owner) && store.Owners(team) <= 1 && store.Members(team).Count > 1) return Err(409, "make someone else owner first");
            return store.Remove(team, user) ? Results.Json(new { ok = true }) : Err(404, "no such member");
        });

        // ---- race results (any member sends the races they drove for the team; everyone in the team sees them) ----
        app.MapPost("/api/v1/teams/{team:long}/results", (HttpContext ctx, long team, ResultReq r) =>
        {
            var me = Me(ctx); if (me == null) return Err(401, "no key"); if (store.RolesIn(team, me.Id) == Role.None) return Err(404, "no such team");
            var (clean, why) = Check.Result(r); if (clean == null) return Err(400, "result: " + why);
            if (store.ResultsToday(team) >= 200) return Err(429, "too many results today");
            var laps = clean.LapRows == null ? null : JsonSerializer.Serialize(clean.LapRows); clean.LapRows = null;   // the laps apart: the list stays small
            bool added = store.AddResult(team, me.Id, clean.Key, clean.Track, clean.Date, JsonSerializer.Serialize(clean, Json), laps);
            return Results.Json(new { added });
        }).RequireRateLimiting("upload");
        app.MapGet("/api/v1/teams/{team:long}/results", (HttpContext ctx, long team) =>
        {
            var me = Me(ctx); if (me == null) return Err(401, "no key"); if (store.RolesIn(team, me.Id) == Role.None) return Err(404, "no such team");
            return Results.Json(store.Results(team, 500).Select(x => new { id = x.Id, laps = x.Laps, result = JsonSerializer.Deserialize<JsonElement>(x.Body) }));
        });
        app.MapGet("/api/v1/teams/{team:long}/results/{id:long}", (HttpContext ctx, long team, long id) =>
        {
            var me = Me(ctx); if (me == null) return Err(401, "no key"); if (store.RolesIn(team, me.Id) == Role.None) return Err(404, "no such team");
            var x = store.Result(team, id); if (x == null) return Err(404, "no such result");
            return Results.Json(new { id, result = JsonSerializer.Deserialize<JsonElement>(x.Value.Body), lapRows = x.Value.Laps == null ? (JsonElement?)null : JsonSerializer.Deserialize<JsonElement>(x.Value.Laps) });
        });
        app.MapDelete("/api/v1/teams/{team:long}/results/{id:long}", (HttpContext ctx, long team, long id) =>
        {
            var me = Me(ctx); if (me == null) return Err(401, "no key");
            var mine = store.RolesIn(team, me.Id); if (mine == Role.None) return Err(404, "no such team"); if (!mine.HasFlag(Role.Owner)) return Err(403, "only the team owner");
            return store.DeleteResult(team, id) ? Results.Json(new { ok = true }) : Err(404, "no such result");
        });

        // ---- race pace (each member sends their own sheet; everyone in the team sees all of them) ----
        app.MapPost("/api/v1/teams/{team:long}/pace", (HttpContext ctx, long team, PaceReq r) =>
        {
            var me = Me(ctx); if (me == null) return Err(401, "no key"); if (store.RolesIn(team, me.Id) == Role.None) return Err(404, "no such team");
            var (rows, why) = Check.Pace(r); if (rows == null) return Err(400, "pace: " + why);
            store.SetPace(team, me.Id, rows); return Results.Json(new { rows = rows.Count });
        }).RequireRateLimiting("upload");
        app.MapGet("/api/v1/teams/{team:long}/pace", (HttpContext ctx, long team) =>
        {
            var me = Me(ctx); if (me == null) return Err(401, "no key"); if (store.RolesIn(team, me.Id) == Role.None) return Err(404, "no such team");
            return Results.Json(store.Pace(team).Select(x => new { user = x.User, name = x.Name, me = x.User == me.Id, track = x.Row.Track, car = x.Row.Car, cls = x.Row.Cls,
                best = x.Row.Best, optimal = x.Row.Optimal, pace = x.Row.Pace, sd = x.Row.Sd, clean = x.Row.Clean, laps = x.Row.Laps, last = x.Row.Last }));
        });

        Web.Map(app, store, KeyUser, log);                                                   // logging in on a phone, Discord (Web.cs)

        app.MapFallback("/api/{**rest}", () => Err(404, "not found"));                         // unknown API paths; the rest: the website's files
        return app;
    }

    // the caller's address: Cloudflare's header (the server is only reachable through the tunnel), else the connection
    static string Address(HttpContext ctx)
    {
        string cf = ctx.Request.Headers["CF-Connecting-IP"];
        return !string.IsNullOrEmpty(cf) && cf.Length < 64 ? cf : ctx.Connection.RemoteIpAddress?.ToString() ?? "?";
    }
}
