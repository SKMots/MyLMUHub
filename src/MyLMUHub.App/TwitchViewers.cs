using System.Net.Http;
using System.Text.RegularExpressions;

namespace MyLMUHub.App;

/// <summary>Viewer count of a Twitch channel for the Twitch chat widget (/api/twitch?channel=). Twitch's own API needs an account key, so this asks the free
/// public helper decapi.me (https://decapi.me/twitch/viewercount/&lt;channel&gt;: a number, or "... is offline"). At most once a minute per channel, only
/// while a widget asks. { live, viewers, error }.</summary>
public sealed class TwitchViewers : IDisposable
{
    readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(8) };
    readonly Dictionary<string, (DateTime At, object Answer)> cache = new();
    static readonly Regex Name = new("^[a-z0-9_]{2,25}$", RegexOptions.Compiled);

    public TwitchViewers() { http.DefaultRequestHeaders.UserAgent.ParseAdd("MyLMUHub"); }

    public async Task<object> Get(string channel)
    {
        channel = (channel ?? "").Trim().ToLowerInvariant();
        if (!Name.IsMatch(channel)) return new { live = false, viewers = 0, error = "not a Twitch channel name" };
        lock (cache) if (cache.TryGetValue(channel, out var c) && DateTime.UtcNow - c.At < TimeSpan.FromSeconds(60)) return c.Answer;
        object answer;
        try
        {
            string text = (await http.GetStringAsync("https://decapi.me/twitch/viewercount/" + channel)).Trim();
            answer = int.TryParse(text, out int n) ? new { live = true, viewers = n, error = "" }
                   : text.Contains("offline", StringComparison.OrdinalIgnoreCase) ? new { live = false, viewers = 0, error = "" }
                   : new { live = false, viewers = 0, error = text.Length > 80 ? text[..80] : text };
        }
        catch (Exception ex) { answer = new { live = false, viewers = 0, error = ex.GetType().Name }; }
        lock (cache) cache[channel] = (DateTime.UtcNow, answer);
        return answer;
    }

    public void Dispose() => http.Dispose();
}
