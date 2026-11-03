namespace Pitwall.Core;

/// <summary>Turns LMU's shared memory (live or a saved image) into a RaceSnapshot of all cars.</summary>
public sealed class SnapshotReader
{
    readonly Catalog cat;
    public SnapshotReader(Catalog catalog) { cat = catalog; }

    long Sc(MemView v, string f, int car) => cat.VehScoring.Base + (long)car * cat.VehScoring.Stride + cat.VehScoring[f].Offset;
    long Te(string f, int tel) => cat.Telem.Base + (long)tel * cat.Telem.Stride + cat.Telem[f].Offset;

    /// <summary>Null when the memory does not look valid (game not in a session).</summary>
    public RaceSnapshot Read(MemView v)
    {
        if (v.Length < cat.MapSize) return null;
        var se = cat.Session;
        int n = (int)v.Num(se["mNumVehicles"], se.Base + se["mNumVehicles"].Offset);
        if (n <= 0 || n > cat.MaxVehicles) return null;

        var snap = new RaceSnapshot();
        snap.Session.Et = v.Num(se["mCurrentET"], se.Base + se["mCurrentET"].Offset);
        snap.Session.EndEt = v.Num(se["mEndET"], se.Base + se["mEndET"].Offset);
        snap.Session.TrackLength = v.Num(se["mLapDist"], se.Base + se["mLapDist"].Offset);
        snap.Session.SessionId = (int)v.Num(se["mSession"], se.Base + se["mSession"].Offset);
        snap.Session.GamePhase = (int)v.Num(se["mGamePhase"], se.Base + se["mGamePhase"].Offset);
        double maxLaps = v.Num(se["mMaxLaps"], se.Base + se["mMaxLaps"].Offset);
        snap.Session.MaxLaps = maxLaps > 0 && maxLaps < 100000 ? (int)maxLaps : 0;     // timed sessions report int.MaxValue
        snap.Session.TrackName = Clean(v.Str(se["mTrackName"], se.Base + se["mTrackName"].Offset));
        snap.Session.AirTemp = S("mAmbientTemp"); snap.Session.TrackTemp = S("mTrackTemp");
        snap.Session.Raining = S("mRaining"); snap.Session.Wetness = S("mAvgPathWetness");
        snap.Session.TimeOfDay = S("mTimeOfDay");
        if (se.Fields.ContainsKey("mYellowFlagState"))
        {
            snap.Session.YellowState = (int)S("mYellowFlagState");
            // mSectorFlag: the header says "not sure if sector 0 is first or last, so test"; ASSUMED like mSector (0 = sector 3, 1 = sector 1, 2 = sector 2)
            snap.Session.SectorYellow = new[] { S("mSectorFlag[1]") != 0, S("mSectorFlag[2]") != 0, S("mSectorFlag[0]") != 0 };
        }

        // the telemetry array is packed: only 'activeVehicles' entries are filled and each carries its own slot id
        var hd = cat.TelemHeader;
        int active = Math.Min((int)v.Num(hd["activeVehicles"], hd.Base + hd["activeVehicles"].Offset), cat.MaxVehicles);
        var slotToTel = new Dictionary<int, int>();
        for (int i = 0; i < active; i++) slotToTel[(int)v.Num(cat.Telem["mID"], Te("mID", i))] = i;

        for (int i = 0; i < n; i++)
        {
            var c = new CarSnap();
            c.Slot = (int)v.Num(cat.VehScoring["mID"], Sc(v, "mID", i));
            c.Driver = Clean(v.Str(cat.VehScoring["mDriverName"], Sc(v, "mDriverName", i)));
            c.Cls = v.Str(cat.VehScoring["mVehicleClass"], Sc(v, "mVehicleClass", i));
            c.Entry = Clean(v.Str(cat.VehScoring["mVehicleName"], Sc(v, "mVehicleName", i)));
            c.Place = (int)Num(v, "mPlace", i);
            c.Laps = (int)Num(v, "mTotalLaps", i);
            c.LapsBehindLeader = (int)Num(v, "mLapsBehindLeader", i);
            c.Best = Pos(Num(v, "mBestLapTime", i));
            c.Last = Pos(Num(v, "mLastLapTime", i));
            c.Cur1 = Pos(Num(v, "mCurSector1", i)); c.Cur2 = Pos(Num(v, "mCurSector2", i));
            c.Last1 = Pos(Num(v, "mLastSector1", i)); c.Last2 = Pos(Num(v, "mLastSector2", i));
            c.BehindNext = Num(v, "mTimeBehindNext", i);
            c.EstLap = Pos(Num(v, "mEstimatedLapTime", i));
            c.LapDist = Num(v, "mLapDist", i);
            c.InPits = Num(v, "mInPits", i) != 0;
            c.InGarage = Num(v, "mInGarageStall", i) != 0;
            c.IsPlayer = Num(v, "mIsPlayer", i) != 0;
            c.X = Num(v, "mPos.x", i); c.Z = Num(v, "mPos.z", i);
            { double vx = Num(v, "mLocalVel.x", i), vy = Num(v, "mLocalVel.y", i), vz = Num(v, "mLocalVel.z", i); c.Speed = Math.Sqrt(vx * vx + vy * vy + vz * vz); }
            if (slotToTel.TryGetValue(c.Slot, out int t))
            {
                c.Detail = Detail(v, t);
                double ve = v.Num(cat.Telem["mVirtualEnergy"], Te("mVirtualEnergy", t));
                c.Ve = ve > 0 ? ve * 100.0 : -1;
                c.Model = Clean(v.Str(cat.Telem["mVehicleModel"], Te("mVehicleModel", t)));
                string tyre = v.Str(cat.Telem["mFrontTireCompoundName"], Te("mFrontTireCompoundName", t));
                c.Tyre = tyre.Length > 0 ? tyre.Substring(0, 1).ToUpperInvariant() : "";
                double ls = v.Num(cat.Telem["mLapStartET"], Te("mLapStartET", t)), el = v.Num(cat.Telem["mElapsedTime"], Te("mElapsedTime", t));
                c.LapTime = ls >= 0 && el >= ls ? el - ls : -1;                               // telemetry clock: finer than the scoring one
                c.DeltaBest = v.Num(cat.Telem["mDeltaBest"], Te("mDeltaBest", t));
            }
            else
            {
                double ls = Num(v, "mLapStartET", i);
                c.LapTime = ls >= 0 && snap.Session.Et >= ls ? snap.Session.Et - ls : -1;
            }
            snap.Cars.Add(c);
        }
        return snap;

        double Num(MemView mv, string f, int car) => mv.Num(cat.VehScoring[f], Sc(mv, f, car));
        double S(string f) => v.Num(se[f], se.Base + se[f].Offset);
    }

    // tyre / fuel / damage / electronics of one telemetry entry. Tyre and brake temperatures are Kelvin in the game (turned into °C here), pressure kPa.
    CarDetail Detail(MemView v, int t)
    {
        double T(string f) => v.Num(cat.Telem[f], Te(f, t));
        var d = new CarDetail
        {
            Fuel = T("mFuel"), FuelCap = T("mFuelCapacity"), RearBias = T("mRearBrakeBias"),
            Tc = (int)T("mTC"), TcSlip = (int)T("mTCSlip"), TcCut = (int)T("mTCCut"), Abs = (int)T("mABS"), Map = (int)T("mMotorMap"),
            Compound = Clean(v.Str(cat.Telem["mFrontTireCompoundName"], Te("mFrontTireCompoundName", t))),
            Detached = T("mDetached") != 0, Rpm = T("mEngineRPM"), Overheating = T("mOverheating") != 0,
        };
        for (int i = 0; i < 8; i++) d.Dents[i] = (int)T(Dent[i]);
        for (int i = 0; i < 4; i++)
        {
            string[] w = Wh[i];
            double a = T(w[0]), b = T(w[1]), c = T(w[2]), k = T(w[3]);
            double s = (T(w[4]) + T(w[5]) + T(w[6])) / 3;
            double? temp = a > 0 && b > 0 && c > 0 && k > 0 ? ((a + b + c) / 3 + k) / 2 - 273.15 : (s > 0 ? s - 273.15 : null);
            double bk = T(w[9]);                                                             // Kelvin in LMU (owner: the dashboard showed ~270° too much as °C)
            double[] temps = a > 0 && b > 0 && c > 0 ? new[] { a - 273.15, b - 273.15, c - 273.15 }
                : (T(w[4]) > 0 && T(w[5]) > 0 && T(w[6]) > 0 ? new[] { T(w[4]) - 273.15, T(w[5]) - 273.15, T(w[6]) - 273.15 } : null);
            d.Wheels[i] = new WheelSnap { Wear = T(w[7]), Temp = temp, Temps = temps, Pressure = T(w[8]), Brake = bk > 0 ? bk - 273.15 : null, Flat = T(w[10]) != 0, Detached = T(w[11]) != 0 };
        }
        return d;
    }

    // field names built once (this runs for every car 10 times a second)
    static readonly string[] Dent = Enumerable.Range(0, 8).Select(i => $"mDentSeverity[{i}]").ToArray();
    static readonly string[][] Wh = Enumerable.Range(0, 4).Select(i => new[] {
        "mTireInnerLayerTemperature[0]", "mTireInnerLayerTemperature[1]", "mTireInnerLayerTemperature[2]", "mTireCarcassTemperature",
        "mTemperature[0]", "mTemperature[1]", "mTemperature[2]", "mWear", "mPressure", "mBrakeTemp", "mFlat", "mDetached" }.Select(f => $"mWheel[{i}].{f}").ToArray()).ToArray();

    static double Pos(double x) => x > 0 ? x : -1;     // the game uses -1 (or 0) for "no time yet"
    static string Clean(string s) => s.Replace('\t', ' ').Replace('\r', ' ').Replace('\n', ' ').Trim();
}
