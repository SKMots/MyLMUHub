namespace MyLMUHub.Core;

/// <summary>The session you are driving NOW, as a Race Pace session: the game writes its results file only when the session ends, so until then the app
/// keeps your laps itself (only laps completed while one of your names drives, LapWatch: counter + time). Track layout, setting and game version come from
/// your last result file on this track (the live data has no layout file name). Changed = a lap was added (the caller then hands it to Race Pace).
/// Each lap also gets the virtual energy it used (%) and the tyre wear left after it (% , average of the 4): online result files have neither.</summary>
public sealed class LiveSession
{
    string key = ""; PaceSession cur; readonly LapWatch watch = new(); double et = -1;
    // VE per lap, followed on the game's lap counter (also over laps without a time: an out lap, a cut): VE when the lap being driven started
    // (-1 = not known: the app came in mid-lap) and what the lap just finished used (null = not known)
    int veLaps = int.MinValue; double veStart = -1; double? veDone;

    public PaceSession Current => cur;

    static string TypeOf(int id) => id >= 10 && id <= 13 ? "Race" : id == 9 ? "Warmup" : id >= 5 && id <= 8 ? "Qualify" : "Practice";

    /// <summary>Call every reading with the car you follow. True = a lap of yours was added.</summary>
    public bool Update(RaceSnapshot snap, CarSnap car, ICollection<string> myNames, Func<string, PaceSession> lastOnTrack)
    {
        if (snap == null || car == null) return false;
        string k = snap.Session.SessionId + "|" + PersonalBest.Norm(snap.Session.TrackName) + "|" + car.Slot;
        bool restart = k != key || snap.Session.Et < et - 30;
        et = snap.Session.Et;
        if (restart) { key = k; cur = null; watch.Reset(); veLaps = car.Laps; veStart = car.Laps == 0 && car.Ve >= 0 ? car.Ve : -1; veDone = null; }   // on the grid: lap 1 starts with this VE
        else if (car.Laps > veLaps)                       // a lap ended (timed or not): a refill (more VE than at its start) or an unknown start = not known
        {
            veDone = veStart >= 0 && car.Ve >= 0 && car.Ve <= veStart ? Math.Round(veStart - car.Ve, 3) : null;
            veStart = car.Laps == veLaps + 1 ? car.Ve : -1; veLaps = car.Laps;
        }
        else if (car.Laps < veLaps) { veLaps = car.Laps; veStart = -1; veDone = null; }
        if (!watch.Step(car.Laps, car.Last, car.InPits, out int lap, out double t, out bool pit)) return false;
        double? ve = veDone;
        var w = car.Detail?.Wheels; double? wear = w != null && w.Length == 4 && w.All(x => x.Wear >= 0) ? Math.Round(w.Average(x => x.Wear) * 100, 2) : null;
        if (!myNames.Any(n => string.Equals(n, car.Driver, StringComparison.OrdinalIgnoreCase))) return false;
        if (cur == null)
        {
            var like = lastOnTrack?.Invoke(snap.Session.TrackName);
            cur = new PaceSession { Live = true, Time = DateTimeOffset.UtcNow.ToUnixTimeSeconds(), Type = TypeOf(snap.Session.SessionId), Track = snap.Session.TrackName,
                Layout = like?.Layout ?? "", Setting = like?.Setting ?? "", Version = like?.Version ?? 0, Car = car.Model.Length > 0 ? car.Model : car.Entry, Veh = car.Entry, Class = car.Cls };
        }
        double? s1 = car.Last1 > 0 ? car.Last1 : null, s2 = car.Last2 > 0 && car.Last1 > 0 ? car.Last2 - car.Last1 : null, s3 = car.Last2 > 0 && t > car.Last2 ? t - car.Last2 : null;   // live sectors are cumulative
        var laps = new List<double?[]>(cur.Laps) { new double?[] { lap, t, s1, s2, s3, pit ? 1 : 0, null, ve, wear } };
        cur = Copy(cur, laps);
        return true;
    }

    // a new object per lap: the page reads the old one while this one is made (no locks)
    static PaceSession Copy(PaceSession s, List<double?[]> laps) => new()
    {
        Live = true, Time = s.Time, Type = s.Type, Track = s.Track, Layout = s.Layout, Setting = s.Setting, Version = s.Version, Car = s.Car, Veh = s.Veh, Class = s.Class, Laps = laps
    };
}
