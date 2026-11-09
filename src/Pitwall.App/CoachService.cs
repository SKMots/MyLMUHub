using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Pitwall.App;

/// <summary>AI Coach (coach.html): the user's own API key for Google Gemini, OpenAI or Anthropic. The key is kept encrypted for this Windows user (DPAPI) in
/// %AppData%\MyLMUHub\coach.json and never goes back to the page; only this class calls the provider, and only when the user clicks (never by itself).
/// Every answer is saved, so looking at it again costs nothing. The prompt (built in the page: coach-math.js) holds numbers only, no names.</summary>
public sealed class CoachService
{
    public sealed class Item
    {
        public string Id { get; set; } = ""; public string Kind { get; set; } = ""; public string Title { get; set; } = ""; public string CacheKey { get; set; } = "";
        public long Time { get; set; } public string Provider { get; set; } = ""; public string Model { get; set; } = "";
        public string Prompt { get; set; } = ""; public string Text { get; set; } = ""; public int InTok { get; set; } public int OutTok { get; set; }
    }
    sealed class Store
    {
        public bool Accepted { get; set; } public long AcceptedAt { get; set; }
        public string Provider { get; set; } = ""; public Dictionary<string, string> Models { get; set; } = new();
        public Dictionary<string, string> Keys { get; set; } = new();                       // provider -> DPAPI-protected key (base64)
        public List<Item> History { get; set; } = new();
    }
    public sealed record AskBody(string Kind, string Title, string CacheKey, string System, string Prompt, int MaxOut, bool Fresh);

    static readonly string[] Providers = { "gemini", "openai", "anthropic" };
    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(120) };
    static readonly JsonSerializerOptions Opt = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true, WriteIndented = false };
    readonly string path = Path.Combine(AppPaths.Dir, "coach.json");
    readonly object gate = new();
    Store store;

    public CoachService() { store = Load(); }
    Store Load()
    {
        try { if (File.Exists(path)) return JsonSerializer.Deserialize<Store>(File.ReadAllText(path), Opt) ?? new Store(); } catch (Exception) { }
        return new Store();
    }
    void Save() { try { File.WriteAllText(path + ".tmp", JsonSerializer.Serialize(store, Opt)); File.Move(path + ".tmp", path, true); } catch (Exception) { } }

    static string Protect(string key) => Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(key), null, DataProtectionScope.CurrentUser));
    static string Unprotect(string b64) { try { return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(b64), null, DataProtectionScope.CurrentUser)); } catch (Exception) { return null; } }
    string Key(string provider) { lock (gate) return store.Keys.TryGetValue(provider, out var k) ? Unprotect(k) : null; }

    /// <summary>The page's view: terms accepted, provider + model, which keys are set (last 4 characters only), the saved answers (without their text).</summary>
    public object Info()
    {
        lock (gate)
        {
            long day = DateTimeOffset.UtcNow.ToUnixTimeSeconds() - 86400;
            return new
            {
                accepted = store.Accepted, provider = store.Provider, models = store.Models,
                keys = Providers.ToDictionary(p => p, p => { var k = store.Keys.TryGetValue(p, out var b) ? Unprotect(b) : null; return k == null ? "" : "…" + k[^Math.Min(4, k.Length)..]; }),
                calls24h = store.History.Count(h => h.Time >= day), tokens24h = store.History.Where(h => h.Time >= day).Sum(h => h.InTok + h.OutTok),
                history = store.History.OrderByDescending(h => h.Time).Select(h => new { h.Id, h.Kind, h.Title, h.CacheKey, h.Time, h.Provider, h.Model, h.InTok, h.OutTok }).ToList(),
            };
        }
    }
    public Item Get(string id) { lock (gate) return store.History.FirstOrDefault(h => h.Id == id); }
    public void Accept(bool on) { lock (gate) { store.Accepted = on; store.AcceptedAt = on ? DateTimeOffset.UtcNow.ToUnixTimeSeconds() : 0; Save(); } }
    public void Delete(string id) { lock (gate) { store.History.RemoveAll(h => h.Id == id); Save(); } }
    /// <summary>Forget everything: keys, answers, the accepted terms.</summary>
    public void Reset() { lock (gate) { store = new Store(); Save(); } }
    public string SetKey(string provider, string key)
    {
        if (!Providers.Contains(provider)) return "unknown provider";
        lock (gate)
        {
            key = (key ?? "").Trim();
            if (key.Length == 0) store.Keys.Remove(provider); else store.Keys[provider] = Protect(key);
            if (key.Length > 0 && store.Provider == "") store.Provider = provider;
            Save(); return "";
        }
    }
    public string Use(string provider, string model)
    {
        if (!Providers.Contains(provider)) return "unknown provider";
        lock (gate) { store.Provider = provider; if (!string.IsNullOrWhiteSpace(model)) store.Models[provider] = model.Trim(); Save(); return ""; }
    }

    // ---------- the providers ----------
    /// <summary>The models this key may use (listing them is free: it also checks the key). { models: [ids] } or { error }.</summary>
    public async Task<object> Models(string provider)
    {
        var key = Key(provider); if (key == null) return new { error = "No key saved for this provider." };
        HttpRequestMessage req = provider switch
        {
            "gemini" => new(HttpMethod.Get, "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000"),
            "openai" => new(HttpMethod.Get, "https://api.openai.com/v1/models"),
            "anthropic" => new(HttpMethod.Get, "https://api.anthropic.com/v1/models?limit=1000"),
            _ => null,
        };
        if (req == null) return new { error = "unknown provider" };
        Auth(req, provider, key);
        try
        {
            using var res = await Http.SendAsync(req); var body = await res.Content.ReadAsStringAsync();
            if (!res.IsSuccessStatusCode) return new { error = Problem((int)res.StatusCode, body) };
            var j = JsonNode.Parse(body); var ids = new List<string>();
            if (provider == "gemini")
                foreach (var m in j?["models"]?.AsArray() ?? new JsonArray())
                {
                    var methods = m?["supportedGenerationMethods"]?.AsArray().Select(x => (string)x).ToList() ?? new();
                    if (methods.Contains("generateContent")) ids.Add(((string)m["name"] ?? "").Replace("models/", ""));
                }
            else foreach (var m in j?["data"]?.AsArray() ?? new JsonArray()) ids.Add((string)m?["id"] ?? "");
            return new { models = ids.Where(x => x.Length > 0).ToList() };
        }
        catch (Exception ex) { return new { error = "Could not reach the provider: " + ex.Message }; }
    }

    static void Auth(HttpRequestMessage req, string provider, string key)
    {
        if (provider == "gemini") req.Headers.Add("x-goog-api-key", key);
        else if (provider == "openai") req.Headers.Add("Authorization", "Bearer " + key);
        else { req.Headers.Add("x-api-key", key); req.Headers.Add("anthropic-version", "2023-06-01"); }
    }
    // a short reason from the provider's error answer
    static string Problem(int status, string body)
    {
        string msg = null;
        try { var j = JsonNode.Parse(body); msg = (string)(j?["error"]?["message"] ?? j?["error"]?["status"]); } catch (Exception) { }
        string why = status switch
        {
            400 => "The provider did not accept the request", 401 or 403 => "The key was refused (wrong key, or no access to this model)",
            404 => "This model does not exist (any more) for your key: pick another", 429 => "Limit reached: too many requests, or your free quota / credit is used up",
            503 => "The model is busy (overloaded) right now", >= 500 => "The provider has a problem right now", _ => "The provider answered " + status,
        };
        return msg != null ? why + ". (" + (msg.Length > 300 ? msg[..300] + "…" : msg) + ")" : why + ".";
    }

    /// <summary>Asks the chosen provider + model. A saved answer for the same question (cache key + prompt + model) is returned without asking again, unless Fresh.
    /// Returns the saved Item, or { error }.</summary>
    public async Task<object> Ask(AskBody b)
    {
        string provider, model;
        lock (gate)
        {
            if (!store.Accepted) return new { error = "Accept the terms first." };
            provider = store.Provider; store.Models.TryGetValue(provider ?? "", out model);
        }
        var key = Key(provider ?? ""); if (key == null) return new { error = "No API key yet: add one under Settings." };
        if (string.IsNullOrWhiteSpace(model)) return new { error = "Pick a model under Settings." };
        if (string.IsNullOrWhiteSpace(b?.Prompt) || b.Prompt.Length > 40_000 || (b.System ?? "").Length > 10_000) return new { error = "Nothing to send (or too much)." };
        if (!b.Fresh)
            lock (gate)
            {
                var hit = store.History.FirstOrDefault(h => h.CacheKey == b.CacheKey && h.Prompt == b.Prompt && h.Model == model && h.Provider == provider);
                if (hit != null) return hit;
            }
        int maxOut = Math.Clamp(b.MaxOut > 0 ? b.MaxOut : 1200, 200, 4000);
        try
        {
            bool light = true; var r = await Call(provider, key, model, b.System ?? "", b.Prompt, maxOut, light);
            if (r.error != null && r.retry) r = await Call(provider, key, model, b.System ?? "", b.Prompt, maxOut, light = false);   // the model does not know the "think less" setting
            // busy (5xx, often 503 "overloaded" on a free tier): asked twice more after a short wait; a refused request is not billed
            for (int wait = 0; r.error != null && r.status >= 500 && wait < 2; wait++)
            {
                await Task.Delay(wait == 0 ? 2000 : 6000);
                r = await Call(provider, key, model, b.System ?? "", b.Prompt, maxOut, light);
            }
            if (r.error != null) return new { error = r.error + (r.status >= 500 ? " Tried 3 times." : ""), busy = r.status >= 500 || r.status == 429, status = r.status };
            var item = new Item
            {
                Id = Guid.NewGuid().ToString("N")[..12], Kind = b.Kind ?? "", Title = b.Title ?? "", CacheKey = b.CacheKey ?? "", Time = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                Provider = provider, Model = model, Prompt = b.Prompt, Text = r.text, InTok = r.inTok, OutTok = r.outTok,
            };
            lock (gate) { store.History.Add(item); if (store.History.Count > 100) store.History.RemoveRange(0, store.History.Count - 100); Save(); }
            return item;
        }
        catch (TaskCanceledException) { return new { error = "No answer within 2 minutes: try again." }; }
        catch (Exception ex) { return new { error = "Could not reach the provider: " + ex.Message }; }
    }

    // one request. light = ask the model to think less (fewer tokens: reasoning models count their thinking as output); retry = the model refused that setting
    async Task<(string text, int inTok, int outTok, string error, bool retry, int status)> Call(string provider, string key, string model, string system, string prompt, int maxOut, bool light)
    {
        HttpRequestMessage req; JsonObject body;
        if (provider == "gemini")
        {
            var gen = new JsonObject { ["maxOutputTokens"] = maxOut + (light ? 0 : 2000) };          // without the setting a thinking model needs room to think
            if (light) gen["thinkingConfig"] = new JsonObject { ["thinkingBudget"] = 0 };
            body = new JsonObject
            {
                ["systemInstruction"] = new JsonObject { ["parts"] = new JsonArray(new JsonObject { ["text"] = system }) },
                ["contents"] = new JsonArray(new JsonObject { ["role"] = "user", ["parts"] = new JsonArray(new JsonObject { ["text"] = prompt }) }),
                ["generationConfig"] = gen,
            };
            req = new(HttpMethod.Post, "https://generativelanguage.googleapis.com/v1beta/models/" + Uri.EscapeDataString(model) + ":generateContent");
        }
        else if (provider == "openai")
        {
            body = new JsonObject
            {
                ["model"] = model, ["max_completion_tokens"] = maxOut + (light ? 1500 : 3000),
                ["messages"] = new JsonArray(new JsonObject { ["role"] = "system", ["content"] = system }, new JsonObject { ["role"] = "user", ["content"] = prompt }),
            };
            if (light) body["reasoning_effort"] = "low";
            req = new(HttpMethod.Post, "https://api.openai.com/v1/chat/completions");
        }
        else
        {
            body = new JsonObject
            {
                ["model"] = model, ["max_tokens"] = maxOut, ["system"] = system,
                ["messages"] = new JsonArray(new JsonObject { ["role"] = "user", ["content"] = prompt }),
            };
            req = new(HttpMethod.Post, "https://api.anthropic.com/v1/messages");
            light = false;
        }
        Auth(req, provider, key);
        req.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        using var res = await Http.SendAsync(req); var text = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode)
        {
            bool retry = light && (int)res.StatusCode == 400 && (text.Contains("reasoning_effort") || text.Contains("thinking", StringComparison.OrdinalIgnoreCase));
            return (null, 0, 0, Problem((int)res.StatusCode, text), retry, (int)res.StatusCode);
        }
        var j = JsonNode.Parse(text); string answer; int i = 0, o = 0;
        if (provider == "gemini")
        {
            answer = string.Concat((j?["candidates"]?[0]?["content"]?["parts"]?.AsArray() ?? new JsonArray()).Where(p => p?["thought"] == null).Select(p => (string)p?["text"] ?? ""));
            i = (int?)j?["usageMetadata"]?["promptTokenCount"] ?? 0; o = ((int?)j?["usageMetadata"]?["candidatesTokenCount"] ?? 0) + ((int?)j?["usageMetadata"]?["thoughtsTokenCount"] ?? 0);
        }
        else if (provider == "openai")
        {
            answer = (string)j?["choices"]?[0]?["message"]?["content"] ?? "";
            i = (int?)j?["usage"]?["prompt_tokens"] ?? 0; o = (int?)j?["usage"]?["completion_tokens"] ?? 0;
        }
        else
        {
            answer = string.Concat((j?["content"]?.AsArray() ?? new JsonArray()).Where(c => (string)c?["type"] == "text").Select(c => (string)c?["text"] ?? ""));
            i = (int?)j?["usage"]?["input_tokens"] ?? 0; o = (int?)j?["usage"]?["output_tokens"] ?? 0;
        }
        if (string.IsNullOrWhiteSpace(answer)) return (null, i, o, "The model gave an empty answer (it may have used all its room to think): try again, or pick a smaller / non-thinking model.", false, 200);
        return (answer.Trim(), i, o, null, false, 200);
    }
}
