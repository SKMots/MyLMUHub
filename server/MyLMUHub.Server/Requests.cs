using System.Globalization;
using System.Text.RegularExpressions;

namespace MyLMUHub.Server;

// What the app may send. JSON only, these fields only (an unknown field = the whole request is refused: Program.cs), every value checked below before
// anything is stored. Text: printable characters only, trimmed, a maximum length; numbers: finite and within sensible limits. Nothing a member sends is
// ever run, opened or saved as a file.

public sealed class SetupReq { public string SetupKey { get; set; } public string Name { get; set; } }
public sealed class JoinReq { public string Code { get; set; } public string Name { get; set; } }
public sealed class NameReq { public string Name { get; set; } }
public sealed class InviteReq { public string[] Roles { get; set; } public int Days { get; set; } = 7; }
public sealed class RolesReq { public string[] Roles { get; set; } }

/// <summary>A race the team drove (the app makes it from the game's results file): the car's result, its drivers and stints.</summary>
public sealed class ResultReq
{
    public string Key { get; set; }                  // the app's id for this race (SHA-256 hex of the results file): the same race twice = once
    public string Track { get; set; }
    public long Date { get; set; }                   // unix seconds
    public double Length { get; set; }               // race length: seconds (timed) or laps
    public string LengthKind { get; set; }           // "time" | "laps"
    public string Car { get; set; }
    public string Cls { get; set; }
    public string Entry { get; set; }
    public string TeamName { get; set; }             // the car's team in the results file (e.g. "Demo Motorsport B Spec"); optional
    public int Pos { get; set; }
    public int ClassPos { get; set; }
    public int Cars { get; set; }
    public int ClassCars { get; set; }
    public int Laps { get; set; }
    public double Best { get; set; }
    public string Finish { get; set; }
    public ResultDriver[] Drivers { get; set; }
    public ResultStint[] Stints { get; set; }
    // optional (2026-11-16, the team race review): every lap of the car, numbers only, -1 = not known:
    // [lap, time s, pit 0/1, driver (index in Drivers), VE used %, VE left %, tyre left %, race clock s] + optionally tyre left per wheel FL FR RL RR (0..1)
    public double[][] LapRows { get; set; }
    public double FinishTime { get; set; }           // race time at the finish (s), 0 = not known; optional
}
/// <summary>A member's race pace for the team: one row per track + car (the hub's Race Pace numbers, dry): best lap, optimal lap, race pace, clean laps, laps, last driven.</summary>
public sealed class PaceReq { public PaceRow[] Rows { get; set; } }
public sealed class PaceRow
{
    public string Track { get; set; } public string Car { get; set; } public string Cls { get; set; }
    public double Best { get; set; } public double Optimal { get; set; } public double Pace { get; set; } public int Clean { get; set; } public int Laps { get; set; } public long Last { get; set; }
    public double Sd { get; set; }                   // consistency: standard deviation of the clean race laps (s), 0 = not known; optional
}
public sealed class ResultDriver { public string Name { get; set; } public int Laps { get; set; } public double Best { get; set; } public double Avg { get; set; } }
public sealed class ResultStint { public string Driver { get; set; } public int Laps { get; set; } public double Avg { get; set; } public double Best { get; set; } }

public static class Check
{
    /// <summary>Trimmed text of printable characters (letters, digits, punctuation, symbols, spaces), 1..max long; null = not allowed.</summary>
    public static string Text(string s, int max, bool required = true)
    {
        if (s == null) return required ? null : "";
        s = s.Trim(); if (s.Length == 0) return required ? null : "";
        if (s.Length > max) return null;
        foreach (char ch in s)
        {
            var cat = char.GetUnicodeCategory(ch);
            if (cat is UnicodeCategory.Control or UnicodeCategory.Format or UnicodeCategory.Surrogate or UnicodeCategory.PrivateUse or UnicodeCategory.OtherNotAssigned
                or UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator) return null;
        }
        return s;
    }
    public static bool Num(double v, double min, double max) => double.IsFinite(v) && v >= min && v <= max;
    public static bool Int(int v, int min, int max) => v >= min && v <= max;

    /// <summary>"driver" / "engineer" / "owner" -> roles; null = an unknown word or none.</summary>
    public static Role? Roles(string[] words)
    {
        if (words == null || words.Length == 0 || words.Length > 3) return null;
        Role r = Role.None;
        foreach (var w in words)
            r |= w switch { "driver" => Role.Driver, "engineer" => Role.Engineer, "owner" => Role.Owner, _ => (Role)(-1) };
        return (int)r < 0 || r == Role.None ? null : r;
    }
    public static string[] Words(Role r) => new[] { (Role.Driver, "driver"), (Role.Engineer, "engineer"), (Role.Owner, "owner") }.Where(x => r.HasFlag(x.Item1)).Select(x => x.Item2).ToArray();

    /// <summary>A member's pace sheet as stored: the checked rows only. null + why = refused.</summary>
    public static (List<PaceRow> Clean, string Why) Pace(PaceReq r)
    {
        if (r?.Rows == null || r.Rows.Length > 400) return (null, "rows");
        long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds(); var l = new List<PaceRow>(); var seen = new HashSet<string>();
        foreach (var x in r.Rows)
        {
            if (x == null) return (null, "row");
            string tr = Text(x.Track, 80), car = Text(x.Car, 80), cls = Text(x.Cls, 30, false);
            if (tr == null || car == null || cls == null) return (null, "text");
            bool T(double v) => v == 0 || Num(v, 20, 1800);
            if (!T(x.Best) || !T(x.Optimal) || !T(x.Pace) || !(x.Sd == 0 || Num(x.Sd, 0.001, 60)) || !Int(x.Clean, 0, 1_000_000) || !Int(x.Laps, 0, 1_000_000) || x.Last < 1_400_000_000 || x.Last > now + 86400) return (null, "numbers");
            if (!seen.Add(tr + "|" + car)) continue;
            l.Add(new PaceRow { Track = tr, Car = car, Cls = cls, Best = Math.Round(x.Best, 3), Optimal = Math.Round(x.Optimal, 3), Pace = Math.Round(x.Pace, 3), Sd = Math.Round(x.Sd, 3), Clean = x.Clean, Laps = x.Laps, Last = x.Last });
        }
        return (l, null);
    }

    static readonly Regex Hex64 = new("^[0-9a-f]{64}$", RegexOptions.CultureInvariant);

    /// <summary>A race result as the server stores it: rebuilt from the checked fields only. null + why = refused.</summary>
    public static (ResultReq Clean, string Why) Result(ResultReq r)
    {
        if (r == null) return (null, "empty");
        if (r.Key == null || !Hex64.IsMatch(r.Key)) return (null, "key");
        var track = Text(r.Track, 80); if (track == null) return (null, "track");
        long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (r.Date < 1_600_000_000 || r.Date > now + 86400) return (null, "date");
        if (r.LengthKind is not ("time" or "laps")) return (null, "lengthKind");
        if (!Num(r.Length, 0, r.LengthKind == "time" ? 7 * 86400 : 10000)) return (null, "length");
        string car = Text(r.Car, 80, false), cls = Text(r.Cls, 30, false), entry = Text(r.Entry, 80, false), finish = Text(r.Finish, 30, false), tname = Text(r.TeamName, 80, false);
        if (car == null || cls == null || entry == null || finish == null || tname == null) return (null, "text");
        if (!Int(r.Pos, 0, 200) || !Int(r.ClassPos, 0, 200) || !Int(r.Cars, 0, 200) || !Int(r.ClassCars, 0, 200) || !Int(r.Laps, 0, 10000)) return (null, "numbers");
        if (!(r.Best == 0 || Num(r.Best, 20, 1800))) return (null, "best");
        if (r.Drivers == null || r.Drivers.Length is < 1 or > 8) return (null, "drivers");
        var drivers = new List<ResultDriver>();
        foreach (var d in r.Drivers)
        {
            var n = Text(d?.Name, 60); if (n == null) return (null, "driver name");
            if (!Int(d.Laps, 0, 10000) || !(d.Best == 0 || Num(d.Best, 20, 1800)) || !(d.Avg == 0 || Num(d.Avg, 20, 1800))) return (null, "driver numbers");
            drivers.Add(new ResultDriver { Name = n, Laps = d.Laps, Best = Math.Round(d.Best, 3), Avg = Math.Round(d.Avg, 3) });
        }
        var stints = new List<ResultStint>();
        if (r.Stints != null)
        {
            if (r.Stints.Length > 60) return (null, "stints");
            foreach (var s in r.Stints)
            {
                var n = Text(s?.Driver, 60); if (n == null) return (null, "stint driver");
                if (!Int(s.Laps, 0, 2000) || !(s.Avg == 0 || Num(s.Avg, 20, 1800)) || !(s.Best == 0 || Num(s.Best, 20, 1800))) return (null, "stint numbers");
                stints.Add(new ResultStint { Driver = n, Laps = s.Laps, Avg = Math.Round(s.Avg, 3), Best = Math.Round(s.Best, 3) });
            }
        }
        double[][] rows = null;
        if (r.LapRows != null)
        {
            if (r.LapRows.Length > 2000) return (null, "lapRows");
            rows = new double[r.LapRows.Length][];
            for (int i = 0; i < r.LapRows.Length; i++)
            {
                var x = r.LapRows[i]; if (x == null || (x.Length != 8 && x.Length != 12)) return (null, "lap row");
                bool M(double v, double lo, double hi) => v == -1 || Num(v, lo, hi);
                if (!Num(x[0], 0, 10000) || !M(x[1], 1, 7200) || !(x[2] == 0 || x[2] == 1) || !(x[3] == -1 || (x[3] >= 0 && x[3] < drivers.Count && x[3] == Math.Floor(x[3])))
                    || !M(x[4], 0, 100) || !M(x[5], 0, 100) || !M(x[6], 0, 100) || !M(x[7], 0, 1_000_000)) return (null, "lap values");
                for (int k = 8; k < x.Length; k++) if (!M(x[k], 0, 1)) return (null, "lap wheels");
                rows[i] = x.Select(v => Math.Round(v, 3)).ToArray();
            }
        }
        if (!(r.FinishTime == 0 || Num(r.FinishTime, 1, 7 * 86400))) return (null, "finishTime");
        return (new ResultReq { Key = r.Key, LapRows = rows, FinishTime = Math.Round(r.FinishTime, 3), Track = track, Date = r.Date, Length = Math.Round(r.Length, 1), LengthKind = r.LengthKind, Car = car, Cls = cls, Entry = entry, TeamName = tname,
            Pos = r.Pos, ClassPos = r.ClassPos, Cars = r.Cars, ClassCars = r.ClassCars, Laps = r.Laps, Best = Math.Round(r.Best, 3), Finish = finish,
            Drivers = drivers.ToArray(), Stints = stints.ToArray() }, null);
    }
}
