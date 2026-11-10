using System.Globalization;
using System.Xml;

namespace MyLMUHub.Core;

/// <summary>One lap from an LMU results file (UserData\Log\Results\*.xml). Times in seconds, null = none ("--.----" or a missing sector).
/// Sectors are each sector's own time (s1 + s2 + s3 = lap). Pit = the car was in the pits during this lap. Wet = on wet tyres. Pos = overall position.
/// Ve = virtual energy used this lap in % (veUsed), Wear = tyre left after the lap in %, average of the 4 (twfl..twrr); null = not in the file (only your own car has them).</summary>
public sealed record ResultLap(int N, double? T, double? S1, double? S2, double? S3, bool Pit, bool Wet, int Pos, string Driver, double? Ve = null, double? Wear = null)
{
    /// <summary>Race clock at the start of the lap (the file's et), -1 = none.</summary>
    public double Et { get; init; } = -1;
    /// <summary>The driver comes from the event log (reliable), not from the swap list.</summary>
    public bool FromLog { get; init; }
}

public sealed class ResultCar
{
    public string Name { get; set; } = "";
    public string CarType { get; set; } = "";
    public string CarClass { get; set; } = "";
    public string VehName { get; set; } = "";
    public string Team { get; set; } = "";
    public bool Human { get; set; }
    public int Pos { get; set; }
    public int ClassPos { get; set; }
    public List<ResultLap> Laps { get; } = new();
    /// <summary>The car's slot in this file's event log (-1 = not found) and who drove each lap according to that log (lap -> driver; only the laps
    /// this game session saw: a file written after leaving / rejoining a race only logs its own part).</summary>
    public int Slot { get; set; } = -1;
    public Dictionary<int, string> LogDrivers { get; } = new();
}

public sealed class ResultSession
{
    public string Type { get; set; } = "";            // Practice / Qualify / Warmup / Race
    public long Time { get; set; }                    // unix seconds
    public string Track { get; set; } = "";           // TrackCourse (the layout)
    public string Venue { get; set; } = "";
    public string Layout { get; set; } = "";          // the track's layout file without folder / .mas (layoutLeMans): tells the layouts of one venue apart
    public double TrackLength { get; set; }
    public string Setting { get; set; } = "";         // Multiplayer / Offline ...
    public double GameVersion { get; set; }           // e.g. 1.42 (<GameVersion>1.4200</GameVersion>), 0 = unknown
    public List<ResultCar> Cars { get; } = new();
    /// <summary>Races: the same race in several files (left and rejoined) has the same key: track, layout and the race clock at the start of lap 1
    /// (every file repeats the whole lap history). "" = not a race.</summary>
    public string RaceKey { get; set; } = "";
}

/// <summary>Reads the game's results XML (rFactor 2 format): the header, the drivers and their laps, and from the event stream the &lt;Score&gt; entries.
/// The driver of each lap: the event log ("Name(slot) lap=L point=0 t=..." = that driver completed lap L, so started lap L+1), else the car's &lt;Swap&gt; list, else the car's
/// driver name; "???" = unknown. Verified 2026-10-29 on 14 endurance races: the swap list is wrong for every lap before the first change the game session
/// saw (it lumps them onto one driver), the log is right (it matched the owner's own stints).</summary>
public static class ResultsXml
{
    static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    static readonly XmlReaderSettings Rs = new() { DtdProcessing = DtdProcessing.Ignore, IgnoreComments = true, IgnoreWhitespace = true, XmlResolver = null };

    public static List<ResultSession> Parse(string path)
    {
        using var s = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, 1 << 16);
        return Parse(s);
    }

    public static List<ResultSession> Parse(Stream stream)
    {
        var list = new List<ResultSession>(); var head = new ResultSession();
        using var r = XmlReader.Create(stream, Rs);
        r.Read();
        while (!r.EOF)                                                                    // ReadElementContentAsString / Skip already move on: only Read() when nothing was consumed
        {
            if (r.NodeType != XmlNodeType.Element || r.Depth != 2) { r.Read(); continue; }
            switch (r.Name)
            {
                case "TrackCourse": head.Track = r.ReadElementContentAsString().Trim(); continue;
                case "TrackVenue": head.Venue = r.ReadElementContentAsString().Trim(); continue;
                case "TrackData": head.Layout = Path.GetFileNameWithoutExtension(r.ReadElementContentAsString().Trim().Replace('\\', '/')); continue;
                case "TrackLength": head.TrackLength = Num(r.ReadElementContentAsString()) ?? 0; continue;
                case "Setting": head.Setting = r.ReadElementContentAsString().Trim(); continue;
                case "GameVersion": head.GameVersion = Num(r.ReadElementContentAsString()) ?? 0; continue;
                case "DateTime": head.Time = (long)(Num(r.ReadElementContentAsString()) ?? 0); continue;
            }
            string type = SessionType(r.Name);
            if (type != null && !r.IsEmptyElement)
            {
                var s = new ResultSession { Type = type, Time = head.Time, Track = head.Track, Venue = head.Venue, Layout = head.Layout, TrackLength = head.TrackLength, Setting = head.Setting, GameVersion = head.GameVersion };
                using (var sub = r.ReadSubtree()) ReadSession(sub, s);
                list.Add(s);
            }
            r.Read();
        }
        return list;
    }

    static string SessionType(string el) =>
        el.StartsWith("Practice") ? "Practice" : el.StartsWith("Qualify") ? "Qualify" : el.StartsWith("Warmup") ? "Warmup" : el.StartsWith("Race") && el != "RaceResults" && el != "RaceLaps" && el != "RaceTime" ? "Race" : null;

    static void ReadSession(XmlReader r, ResultSession s)
    {
        var log = new Log();
        r.Read(); r.Read();                                                               // past the session element itself
        while (!r.EOF)
        {
            if (r.NodeType != XmlNodeType.Element) { r.Read(); continue; }
            if (r.Name == "DateTime" && r.Depth == 1) { s.Time = (long)(Num(r.ReadElementContentAsString()) ?? s.Time); continue; }
            if (r.Name == "Stream" && !r.IsEmptyElement) { using (var st = r.ReadSubtree()) ReadStream(st, log); }
            else if (r.Name == "Driver" && !r.IsEmptyElement) { using (var d = r.ReadSubtree()) s.Cars.Add(ReadCar(d)); }
            r.Read();
        }
        Attach(s, log);
        if (s.Type == "Race")
        {
            var starts = s.Cars.SelectMany(c => c.Laps).Where(l => l.N == 1 && l.Et > 0).Select(l => l.Et).ToList();
            if (starts.Count > 0) s.RaceKey = s.Track + "|" + s.Layout + "|" + starts.Min().ToString("0.0", Inv);
        }
    }

    // the event log: per slot, who completed each lap and its time (to find which car a slot is)
    sealed class Log { public readonly Dictionary<int, Dictionary<int, (string Name, double T)>> Done = new(); }
    static readonly System.Text.RegularExpressions.Regex ScoreRx = new(@"^(.*)\((\d+)\) lap=(\d+) point=(\d+) t=(-?[\d.]+)", System.Text.RegularExpressions.RegexOptions.Compiled);
    static void ReadStream(XmlReader r, Log log)
    {
        while (!r.EOF)
        {
            if (r.NodeType == XmlNodeType.Element && r.Name == "Score")
            {
                var m = ScoreRx.Match(r.ReadElementContentAsString().Trim());
                if (!m.Success) continue;
                string name = m.Groups[1].Value.Trim(); int slot = int.Parse(m.Groups[2].Value, Inv), lap = int.Parse(m.Groups[3].Value, Inv), point = int.Parse(m.Groups[4].Value, Inv);
                double t = Num(m.Groups[5].Value) ?? -1;
                if (name.Length == 0) continue;
                if (point != 0) continue;                                                // point 1 / 2 = the sectors: not needed
                if (!log.Done.TryGetValue(slot, out var d)) log.Done[slot] = d = new();
                d[lap] = (name, t);                                                       // `name` completed lap `lap` in `t` s
                continue;
            }
            r.Read();
        }
    }
    // which car is which slot (the slot whose logged lap times are this car's lap times), then the driver of every lap: the log, else the swap list
    static void Attach(ResultSession s, Log log)
    {
        if (log.Done.Count == 0) return;
        foreach (var c in s.Cars)
        {
            var times = c.Laps.Where(l => l.T != null).ToDictionary(l => l.N, l => l.T.Value);
            int best = -1, hits = 0;
            foreach (var kv in log.Done)
            {
                int h = kv.Value.Count(x => x.Value.T > 0 && times.TryGetValue(x.Key, out var t) && Math.Abs(t - x.Value.T) < 0.002);
                if (h > hits) { hits = h; best = kv.Key; }
            }
            if (best < 0) continue;
            c.Slot = best;
            // a lap belongs to the driver who STARTED it (as the game's own swap list and the drivers count it: the lap with the stop is the old driver's in-lap) =
            // whoever completed the lap before; lap 1 = whoever completed it. A lap whose previous lap this file did not log stays with the swap list's guess.
            if (!log.Done.TryGetValue(best, out var done)) continue;
            foreach (var l in c.Laps)
            {
                if (done.TryGetValue(l.N - 1, out var prev)) c.LogDrivers[l.N] = prev.Name;
                else if (l.N == 1 && done.TryGetValue(1, out var first)) c.LogDrivers[1] = first.Name;
            }
            for (int i = 0; i < c.Laps.Count; i++)
                if (c.LogDrivers.TryGetValue(c.Laps[i].N, out var who)) c.Laps[i] = c.Laps[i] with { Driver = who, FromLog = true };
        }
    }

    static ResultCar ReadCar(XmlReader r)
    {
        var c = new ResultCar(); var swaps = new List<(int From, int To, string Name)>(); var raw = new List<(int N, double? T, double? S1, double? S2, double? S3, bool Pit, bool Wet, int Pos, double? Ve, double? Wear, double Et)>();
        r.Read(); r.Read();                                                               // past <Driver>
        while (!r.EOF)
        {
            if (r.NodeType != XmlNodeType.Element || r.Depth != 1) { r.Read(); continue; }
            switch (r.Name)
            {
                case "Name": c.Name = r.ReadElementContentAsString().Trim(); continue;
                case "CarType": c.CarType = r.ReadElementContentAsString().Trim(); continue;
                case "CarClass": c.CarClass = r.ReadElementContentAsString().Trim(); continue;
                case "VehName": c.VehName = r.ReadElementContentAsString().Trim(); continue;
                case "TeamName": c.Team = r.ReadElementContentAsString().Trim(); continue;
                case "isPlayer": c.Human = r.ReadElementContentAsString().Trim() == "1"; continue;
                case "Position": c.Pos = (int)(Num(r.ReadElementContentAsString()) ?? 0); continue;
                case "ClassPosition": c.ClassPos = (int)(Num(r.ReadElementContentAsString()) ?? 0); continue;
                case "Swap":
                    {
                        int from = (int)(Num(r.GetAttribute("startLap")) ?? 0), to = (int)(Num(r.GetAttribute("endLap")) ?? 0);
                        swaps.Add((from, to, r.ReadElementContentAsString().Trim())); continue;
                    }
                case "Lap":
                    {
                        int n = (int)(Num(r.GetAttribute("num")) ?? 0), pos = (int)(Num(r.GetAttribute("p")) ?? 0); double et = Num(r.GetAttribute("et")) ?? -1;
                        double? s1 = Pos(r.GetAttribute("s1")), s2 = Pos(r.GetAttribute("s2")), s3 = Pos(r.GetAttribute("s3"));
                        bool pit = r.GetAttribute("pit") == "1";
                        bool wet = Wet(r.GetAttribute("fcompound")) || Wet(r.GetAttribute("rcompound"));
                        double? ve = Pos(r.GetAttribute("veUsed")) * 100, wear = null;
                        double?[] tw = { Num(r.GetAttribute("twfl")), Num(r.GetAttribute("twfr")), Num(r.GetAttribute("twrl")), Num(r.GetAttribute("twrr")) };
                        if (tw.All(w => w is >= 0 and <= 1)) wear = tw.Average() * 100;
                        double? t = Pos(r.ReadElementContentAsString());
                        raw.Add((n, t, s1, s2, s3, pit, wet, pos, ve, wear, et)); continue;
                    }
            }
            r.Skip();
        }
        foreach (var l in raw)
        {
            string driver = c.Name;
            foreach (var sw in swaps) if (l.N >= sw.From && l.N <= sw.To) { driver = sw.Name; break; }
            if (driver == "???") driver = "";
            c.Laps.Add(new ResultLap(l.N, l.T, l.S1, l.S2, l.S3, l.Pit, l.Wet, l.Pos, driver, l.Ve, l.Wear) { Et = l.Et });
        }
        return c;
    }

    static bool Wet(string compound) => compound != null && (compound.Contains("wet", StringComparison.OrdinalIgnoreCase) || compound.Contains("inter", StringComparison.OrdinalIgnoreCase));
    static double? Num(string s) => double.TryParse(s, NumberStyles.Float, Inv, out double v) ? v : null;
    static double? Pos(string s) { var v = Num(s); return v > 0 ? v : null; }

    /// <summary>The human drivers of a session (cars flagged isPlayer; with their swap drivers), for the "who are you" list.</summary>
    public static IEnumerable<string> Humans(ResultSession s) =>
        s.Cars.Where(c => c.Human).SelectMany(c => c.Laps.Select(l => l.Driver).Append(c.Name)).Where(n => n.Length > 0 && n != "???").Distinct();
}

/// <summary>Your laps of one session (one car), plus what the page needs to compare them with: the fastest lap of your class in that session.
/// Laps = [n, time, s1, s2, s3, flags (1 = pit, 2 = wet), position, VE used %, tyre left % (average of 4)] (null = none). Numbers only; the page does the maths and formatting.</summary>
public sealed class PaceSession
{
    public string File { get; set; } = "";
    public long Time { get; set; }
    public string Type { get; set; } = "";
    public string Track { get; set; } = "";
    public string Layout { get; set; } = "";
    public string Setting { get; set; } = "";
    public double Version { get; set; }               // game version the session was driven on (1.42), 0 = unknown
    public string Car { get; set; } = "";
    public string Veh { get; set; } = "";
    public string Class { get; set; } = "";
    public int ClassPos { get; set; }
    public int ClassCars { get; set; }
    public double? ClassBest { get; set; }
    public List<double?[]> Laps { get; set; } = new();
    /// <summary>Races: the same race in several files has the same key (ResultSession.RaceKey); Merge makes them one session.</summary>
    public string RaceKey { get; set; } = "";
    /// <summary>The session you are driving now, from the live data (LiveSession): its results file is written when it ends and then replaces it.</summary>
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingDefault)]
    public bool Live { get; set; }

    public static List<PaceSession> Mine(ResultSession s, ICollection<string> names, string file)
    {
        var res = new List<PaceSession>();
        if (names.Count == 0) return res;
        foreach (var c in s.Cars)
        {
            bool logged = c.LogDrivers.Count > 0;                                        // a log: only the laps it saw are counted here (the swap list lumps); another file of the same race has the rest
            var laps = c.Laps.Where(l => names.Contains(l.Driver) && (l.FromLog || !logged)).ToList();
            if (laps.Count == 0) continue;
            var cls = s.Cars.Where(o => o.CarClass == c.CarClass).ToList();
            double? best = cls.SelectMany(o => o.Laps).Where(l => l.T != null && !l.Pit).Select(l => l.T).DefaultIfEmpty(null).Min();
            res.Add(new PaceSession
            {
                File = file, Time = s.Time, Type = s.Type, Track = s.Track, RaceKey = s.RaceKey, Layout = s.Layout, Setting = s.Setting, Version = s.GameVersion, Car = c.CarType, Veh = c.VehName, Class = c.CarClass,
                ClassPos = c.ClassPos, ClassCars = cls.Count, ClassBest = best,
                Laps = laps.Select(l => new double?[] { l.N, l.T, l.S1, l.S2, l.S3, (l.Pit ? 1 : 0) + (l.Wet ? 2 : 0), l.Pos, Round(l.Ve, 3), Round(l.Wear, 2) }).ToList()
            });
        }
        return res;
    }
    static double? Round(double? v, int d) => v.HasValue ? Math.Round(v.Value, d) : null;

    /// <summary>One race in several results files (you left and rejoined, e.g. to practise while a team-mate drove) becomes ONE session: same race key and car,
    /// files within 2 days of each other. Laps = every lap of yours any of the files logged (each lap once), time = the first file's (closest to the start),
    /// result (position, class best, file) = the last file's. Other sessions are returned as they are.</summary>
    public static List<PaceSession> Merge(IEnumerable<PaceSession> sessions)
    {
        var outList = new List<PaceSession>(); var open = new Dictionary<string, List<PaceSession>>();
        foreach (var s in sessions.OrderBy(x => x.Time))
        {
            if (string.IsNullOrEmpty(s.RaceKey)) { outList.Add(s); continue; }
            string k = s.RaceKey + "|" + s.Veh;
            if (open.TryGetValue(k, out var g) && s.Time - g[0].Time <= 2 * 86400) g.Add(s);
            else { if (g != null) outList.Add(Join(g)); open[k] = new List<PaceSession> { s }; }
        }
        foreach (var g in open.Values) outList.Add(Join(g));
        return outList.OrderBy(x => x.Time).ToList();
    }
    static PaceSession Join(List<PaceSession> g)
    {
        if (g.Count == 1) return g[0];
        var last = g[^1]; var laps = new SortedDictionary<int, double?[]>();
        foreach (var s in g) foreach (var l in s.Laps) { int n = (int)(l[0] ?? 0); laps.TryAdd(n, l); }
        return new PaceSession
        {
            File = last.File, Time = g[0].Time, Type = last.Type, Track = last.Track, Layout = last.Layout, Setting = last.Setting, Version = last.Version, Car = last.Car, Veh = last.Veh,
            Class = last.Class, ClassPos = last.ClassPos, ClassCars = last.ClassCars, ClassBest = g.Select(s => s.ClassBest).Where(b => b != null).DefaultIfEmpty(null).Min(),
            RaceKey = last.RaceKey, Laps = laps.Values.ToList(),
        };
    }
}
