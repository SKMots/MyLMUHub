using System.Security.Cryptography;
using System.Text;

namespace MyLMUHub.Server;

/// <summary>Member keys and invite codes. Both are random (a cryptographic generator) and only their SHA-256 hash is stored: a copy of the database gives
/// nobody a working key or code. A key is sent by the app as "Authorization: Bearer mlh_..." on every request.</summary>
public static class Auth
{
    // invite codes: 12 letters / digits without look-alikes (0 O 1 I L): 31^12 = 7.9e17 codes, tried at most a few times a minute (rate limit)
    const string CodeChars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

    public static string NewKey() => "mlh_" + Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static string NewCode()
    {
        var b = new char[12];
        for (int i = 0; i < b.Length; i++) b[i] = CodeChars[RandomNumberGenerator.GetInt32(CodeChars.Length)];
        return new string(b, 0, 4) + "-" + new string(b, 4, 4) + "-" + new string(b, 8, 4);
    }

    /// <summary>A code as typed (spaces, dashes, lower case allowed) in its one form; null = cannot be a code.</summary>
    public static string NormCode(string code)
    {
        if (code == null || code.Length > 40) return null;
        var s = new string(code.Where(char.IsLetterOrDigit).Select(char.ToUpperInvariant).ToArray());
        return s.Length == 12 && s.All(c => CodeChars.Contains(c)) ? s : null;
    }

    public static string Hash(string s) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s ?? "")));

    /// <summary>The key from "Authorization: Bearer mlh_..."; null = none / not a key.</summary>
    public static string KeyOf(HttpRequest r)
    {
        string h = r.Headers.Authorization; if (string.IsNullOrEmpty(h) || h.Length > 200 || !h.StartsWith("Bearer ", StringComparison.Ordinal)) return null;
        var k = h[7..].Trim(); return k.StartsWith("mlh_", StringComparison.Ordinal) && k.Length is > 20 and < 100 ? k : null;
    }
}

/// <summary>What a member may do in a team (several at once: a driver who is also an engineer).</summary>
[Flags]
public enum Role { None = 0, Driver = 1, Engineer = 2, Owner = 4 }
