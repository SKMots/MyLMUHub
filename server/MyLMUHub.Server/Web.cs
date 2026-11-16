using System.Net.Http.Headers;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace MyLMUHub.Server;

/// <summary>The website (2026-11-16): the home page and the phone app (wwwroot: / and /app/), logging in on a phone, Discord.
/// A phone gets a login cookie (HttpOnly, Secure, SameSite=Lax, 30 days, stored only as a hash) in two ways:
///  - a pairing code made by the desktop app (one use, 2 minutes), typed on the phone;
///  - Discord: the member links their Discord account once from the desktop app; then "Log in with Discord" on the phone. Only the "identify" scope (who
///    you are): no messages, no servers; the Discord token is used once and never kept, only the Discord id and name.
/// A phone login can only LOOK: the API accepts it for GET requests only (Program.cs Me), so a lost phone cannot change anything. Configuration (environment):
/// MLH_PUBLIC_URL (https://mylmuhub.com), MLH_DISCORD_CLIENT_ID, MLH_DISCORD_CLIENT_SECRET (Discord off when not set).</summary>
public static class Web
{
    public const string Cookie = "mlh_s", StateCookie = "mlh_os";
    static readonly HttpClient discord = new() { Timeout = TimeSpan.FromSeconds(10) };

    public sealed class PairReq { public string Code { get; set; } }

    static bool Local(HttpContext ctx) => ctx.Request.Host.Host is "localhost" or "127.0.0.1";
    static CookieOptions Opts(HttpContext ctx, TimeSpan age, string path = "/") => new()
    { HttpOnly = true, Secure = !Local(ctx), SameSite = SameSiteMode.Lax, Path = path, MaxAge = age, IsEssential = true };
    // a request that changes something with the login cookie must come from this site's own page
    static bool SameOrigin(HttpContext ctx)
    {
        string o = ctx.Request.Headers.Origin; if (string.IsNullOrEmpty(o)) return false;
        return Uri.TryCreate(o, UriKind.Absolute, out var u) && string.Equals(u.Host, ctx.Request.Host.Host, StringComparison.OrdinalIgnoreCase);
    }
    static string Label(HttpContext ctx) { string ua = ctx.Request.Headers.UserAgent; ua ??= ""; return ua.Contains("iPhone") ? "iPhone" : ua.Contains("Android") ? "Android" : ua.Contains("iPad") ? "iPad" : "browser"; }

    // a small page for the Discord steps (text only, escaped)
    static IResult Page(string title, string text, bool ok)
    {
        var e = HtmlEncoder.Default;
        var html = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>My LMU Hub</title>" +
                   "<link rel=\"stylesheet\" href=\"/css/site.css\"></head><body><main class=\"msg\"><img src=\"/img/logo.svg\" alt=\"\" width=\"64\" height=\"64\"><h1" + (ok ? "" : " class=\"bad\"") + ">" + e.Encode(title) +
                   "</h1><p>" + e.Encode(text) + "</p><a class=\"btn\" href=\"/app/\">Open My LMU Hub</a></main></body></html>";
        return Results.Content(html, "text/html; charset=utf-8");
    }

    public static void Map(WebApplication app, Store store, Func<HttpContext, User> keyUser, ILogger log)
    {
        string publicUrl = (Environment.GetEnvironmentVariable("MLH_PUBLIC_URL") ?? "").TrimEnd('/');
        string clientId = Environment.GetEnvironmentVariable("MLH_DISCORD_CLIENT_ID") ?? "", secret = Environment.GetEnvironmentVariable("MLH_DISCORD_CLIENT_SECRET") ?? "";
        bool discordOn = publicUrl.StartsWith("https://") && clientId.Length > 0 && secret.Length > 0;
        string redirect = publicUrl + "/auth/discord/callback";
        IResult Err(int code, string why) => Results.Json(new { error = why }, statusCode: code);

        app.MapGet("/api/v1/web/config", () => Results.Json(new { discord = discordOn }));

        // ---- pairing code: made by the desktop app (member key), typed on the phone ----
        app.MapPost("/api/v1/web/pair", (HttpContext ctx) =>
        {
            var me = keyUser(ctx); if (me == null) return Err(401, "no key");
            return Results.Json(new { code = store.AddPairCode(me.Id), seconds = 120 });
        });
        app.MapPost("/api/v1/web/pair/redeem", (HttpContext ctx, PairReq r) =>
        {
            if (!SameOrigin(ctx)) return Err(403, "from this site only");
            var u = store.RedeemPairCode(r?.Code); if (u == null) return Err(404, "unknown or expired code");
            ctx.Response.Cookies.Append(Cookie, store.AddSession(u.Value, Label(ctx)), Opts(ctx, TimeSpan.FromDays(Store.SessionDays)));
            log.LogInformation("Phone login (pairing code) for user {u}", u.Value);
            return Results.Json(new { ok = true });
        }).RequireRateLimiting("join");
        app.MapPost("/api/v1/web/logout", (HttpContext ctx) =>
        {
            if (!SameOrigin(ctx)) return Err(403, "from this site only");
            store.EndSession(ctx.Request.Cookies[Cookie]); ctx.Response.Cookies.Delete(Cookie, Opts(ctx, TimeSpan.Zero));
            return Results.Json(new { ok = true });
        });
        // the desktop app: log out every phone / browser
        app.MapPost("/api/v1/web/logout-all", (HttpContext ctx) =>
        {
            var me = keyUser(ctx); if (me == null) return Err(401, "no key");
            return Results.Json(new { ended = store.EndAllSessions(me.Id) });
        });

        // ---- Discord ----
        app.MapPost("/api/v1/discord/link", (HttpContext ctx) =>
        {
            var me = keyUser(ctx); if (me == null) return Err(401, "no key"); if (!discordOn) return Err(409, "Discord is not set up on this server");
            var st = store.AddOAuthState("link", me.Id);
            return Results.Json(new { url = Authorize(clientId, redirect, st) });
        });
        app.MapPost("/api/v1/discord/unlink", (HttpContext ctx) =>
        {
            var me = keyUser(ctx); if (me == null) return Err(401, "no key");
            store.UnlinkDiscord(me.Id); return Results.Json(new { ok = true });
        });
        app.MapGet("/auth/discord/login", (HttpContext ctx) =>
        {
            if (!discordOn) return Page("Discord is not set up", "Log in with a pairing code from the desktop app instead.", false);
            var st = store.AddOAuthState("login", null);
            ctx.Response.Cookies.Append(StateCookie, st, Opts(ctx, TimeSpan.FromMinutes(10), "/auth"));     // this browser started it (no login slipped in from elsewhere)
            return Results.Redirect(Authorize(clientId, redirect, st));
        }).RequireRateLimiting("join");
        app.MapGet("/auth/discord/callback", async (HttpContext ctx, string code, string state) =>
        {
            if (!discordOn) return Page("Discord is not set up", "", false);
            var s = store.TakeOAuthState(state);
            if (s == null) return Page("That did not work", "The Discord step expired or was used already. Try again.", false);
            if (s.Value.Kind == "login" && ctx.Request.Cookies[StateCookie] != state) return Page("That did not work", "Start the Discord login on this device again.", false);
            ctx.Response.Cookies.Delete(StateCookie, Opts(ctx, TimeSpan.Zero, "/auth"));
            var who = await DiscordUser(clientId, secret, redirect, code);
            if (who == null) return Page("That did not work", "Discord did not confirm the login. Try again.", false);
            if (s.Value.Kind == "link" && s.Value.User is long uid)
            {
                if (!store.LinkDiscord(uid, who.Value.Id, who.Value.Name)) return Page("Already linked", "This Discord account is linked to another member.", false);
                log.LogInformation("Discord linked for user {u}", uid);
                return Page("Discord linked", "You can now log in on your phone with Discord (" + who.Value.Name + "). You can close this page.", true);
            }
            var user = store.UserByDiscord(who.Value.Id);
            if (user == null) return Page("Not linked yet", "This Discord account (" + who.Value.Name + ") is not linked to a member. In the desktop app: Team > Account > Link my Discord. Or log in with a pairing code.", false);
            ctx.Response.Cookies.Append(Cookie, store.AddSession(user.Value, Label(ctx)), Opts(ctx, TimeSpan.FromDays(Store.SessionDays)));
            log.LogInformation("Phone login (Discord) for user {u}", user.Value);
            return Results.Redirect("/app/");
        }).RequireRateLimiting("join");
    }

    static string Authorize(string clientId, string redirect, string state) =>
        "https://discord.com/oauth2/authorize?response_type=code&scope=identify&prompt=none&client_id=" + Uri.EscapeDataString(clientId) +
        "&redirect_uri=" + Uri.EscapeDataString(redirect) + "&state=" + Uri.EscapeDataString(state);

    // the code -> a token (used once, not kept) -> who it is
    static async Task<(string Id, string Name)?> DiscordUser(string clientId, string secret, string redirect, string code)
    {
        if (string.IsNullOrEmpty(code) || code.Length > 200) return null;
        try
        {
            var tr = new HttpRequestMessage(HttpMethod.Post, "https://discord.com/api/oauth2/token")
            { Content = new FormUrlEncodedContent(new Dictionary<string, string> { ["grant_type"] = "authorization_code", ["code"] = code, ["redirect_uri"] = redirect }) };
            tr.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(clientId + ":" + secret)));
            using var t = await discord.SendAsync(tr); if (!t.IsSuccessStatusCode) return null;
            var token = JsonDocument.Parse(await t.Content.ReadAsStringAsync()).RootElement.GetProperty("access_token").GetString();
            var ur = new HttpRequestMessage(HttpMethod.Get, "https://discord.com/api/users/@me"); ur.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var u = await discord.SendAsync(ur); if (!u.IsSuccessStatusCode) return null;
            var j = JsonDocument.Parse(await u.Content.ReadAsStringAsync()).RootElement;
            string id = j.GetProperty("id").GetString(), name = j.TryGetProperty("global_name", out var g) && g.ValueKind == JsonValueKind.String ? g.GetString() : j.GetProperty("username").GetString();
            if (string.IsNullOrEmpty(id) || id.Length > 30 || !id.All(char.IsDigit)) return null;
            return (id, Check.Text(name, 40) ?? "Discord user");
        }
        catch (Exception) { return null; }
    }
}
