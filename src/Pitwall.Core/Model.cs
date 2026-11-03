using System.Text.Json.Serialization;

namespace Pitwall.Core;

// ---------- input: one reading of the game (all cars) ----------

public sealed class SessionSnap
{
    public double Et { get; set; }            // current session time (s)
    public double EndEt { get; set; }         // session end time (s), 0 = unknown
    public double TrackLength { get; set; }   // one lap in metres, 0 = unknown
    public int SessionId { get; set; }        // mSession: 0 test day, 1-4 practice, 5-8 qualifying, 9 warm-up, 10-13 race
    public int MaxLaps { get; set; }          // lap-limited session, 0 = none (timed)
    public int GamePhase { get; set; } = -1;  // mGamePhase: 0 before, 1 recon, 2 grid walk, 3 formation, 4 countdown, 5 green, 6 full course yellow, 7 stopped, 8 over, 9 paused
    public string TrackName { get; set; } = "";
    public double AirTemp { get; set; }       // °C
    public double TrackTemp { get; set; }     // °C
    public double Raining { get; set; }       // 0..1
    public double Wetness { get; set; }       // average path wetness 0..1
    public double TimeOfDay { get; set; } = -1;   // mTimeOfDay as the game gives it (unit not verified), -1 = none
    public int YellowState { get; set; } = -1;    // mYellowFlagState (full course): -1 invalid, 0 none, 1 pending, 2 pits closed, 3 pit lead lap, 4 pits open, 5 last lap, 6 resume
    public bool[] SectorYellow { get; set; } = new bool[3];   // local yellow in sector 1, 2, 3 (mSectorFlag; its index order is ASSUMED to be the game's 0 = sector 3, see SnapshotReader)
}

/// <summary>One wheel of a car's telemetry. Temperatures in °C, pressure in kPa, wear = fraction LEFT (1 = new).</summary>
public sealed class WheelSnap
{
    public double Wear { get; set; } = -1;
    public double? Temp { get; set; }                   // tyre: average of inner layer and carcass (else surface), null = none
    public double[] Temps { get; set; }                 // across the tread: left, middle, right (inner layer, else surface) in °C; null = none
    public double Pressure { get; set; } = -1;
    public double? Brake { get; set; }
    public bool Flat { get; set; }
    public bool Detached { get; set; }
}

/// <summary>The telemetry details of one car (every car has a telemetry entry, so this works while spectating).</summary>
public sealed class CarDetail
{
    public double Fuel { get; set; } = -1;           // litres
    public double FuelCap { get; set; } = -1;
    public double RearBias { get; set; } = -1;       // fraction to the rear
    public int Tc { get; set; } = -1;
    public int TcSlip { get; set; } = -1;
    public int TcCut { get; set; } = -1;
    public int Abs { get; set; } = -1;
    public int Map { get; set; } = -1;               // motor / engine map
    public string Compound { get; set; } = "";       // front compound name
    public double Rpm { get; set; } = -1;            // engine rpm
    public bool Overheating { get; set; }            // the game's engine overheating flag
    public int[] Dents { get; set; } = new int[8];   // 0 none, 1 light, 2 heavy
    public bool Detached { get; set; }
    public WheelSnap[] Wheels { get; set; } = { new(), new(), new(), new() };   // FL FR RL RR
}

public sealed class CarSnap
{
    public int Slot { get; set; }             // scoring slot id (NOT the telemetry array index)
    public string Driver { get; set; } = "";
    public string Cls { get; set; } = "";
    public string Entry { get; set; } = "";   // team / entry name
    public string Model { get; set; } = "";   // car model (from telemetry)
    public string Tyre { get; set; } = "";    // first letter of the front tyre compound
    public double Ve { get; set; } = -1;      // virtual energy %, -1 = none
    public int Place { get; set; }            // overall position
    public int Laps { get; set; }
    public int LapsBehindLeader { get; set; }
    public double Best { get; set; } = -1;
    public double Last { get; set; } = -1;
    public double Cur1 { get; set; } = -1;    // sector times in LMU scoring are CUMULATIVE (cur2 = S1+S2)
    public double Cur2 { get; set; } = -1;
    public double Last1 { get; set; } = -1;
    public double Last2 { get; set; } = -1;
    public double BehindNext { get; set; }    // seconds behind the next car in the overall order
    public double EstLap { get; set; } = -1;  // the game's estimated lap time (mEstimatedLapTime: what its own relative uses), -1 = none
    public double LapDist { get; set; }       // metres round the current lap
    public bool InPits { get; set; }
    public bool InGarage { get; set; }
    public bool IsPlayer { get; set; }        // NOT set while spectating
    public double LapTime { get; set; } = -1; // time into the current lap (s), -1 = none
    public double? DeltaBest { get; set; }    // the game's live delta to this car's best lap (telemetry mDeltaBest), null = none
    public double X { get; set; }             // world position (scoring mPos.x / mPos.z) for the track map
    public double Z { get; set; }
    public double Speed { get; set; } = -1;   // m/s (scoring mLocalVel), -1 = not known (a JSON replay)
    public CarDetail Detail { get; set; }     // telemetry details, null = none (e.g. a JSON replay)
}

/// <summary>The car chosen in the page's spectate picker: this driver, else the car (entry) they were in (follows the car after a driver swap).</summary>
public sealed record SpectateTarget(string Driver, string Entry);

public sealed class RaceSnapshot
{
    public SessionSnap Session { get; set; } = new();
    public List<CarSnap> Cars { get; set; } = new();
}

// ---------- output: what the widgets show (numbers only; the browser formats them) ----------

public sealed class GapInfo
{
    public string Kind { get; set; } = "none";   // none | time | laps
    public string Sign { get; set; } = "";       // + = ahead of the focus car, - = behind
    public double Value { get; set; }            // seconds, or whole laps
}

public sealed class DeltaInfo
{
    public bool Has { get; set; }
    public double Value { get; set; }            // focus car's last lap minus this car's last lap
    public int Flag { get; set; }                // 1 = this car was faster, 2 = slower
}

public sealed class StandingRow
{
    public bool Focus { get; set; }
    public int ClassPos { get; set; }
    public int Overall { get; set; }
    public string Driver { get; set; } = "";
    public string Model { get; set; } = "";
    public string Entry { get; set; } = "";
    public string Tyre { get; set; } = "";
    public double Ve { get; set; } = -1;
    public double S1 { get; set; } = -1;
    public double S2 { get; set; } = -1;
    public double S3 { get; set; } = -1;
    public double Best { get; set; } = -1;
    public int BestFlag { get; set; }            // 1 = class best
    public double Last { get; set; } = -1;
    public int LastFlag { get; set; }            // 1 = class best, 2 = own best
    public double Avg { get; set; } = -1;        // average of the last 5 clean laps
    public bool Pit { get; set; }
    public int Laps { get; set; }
    public GapInfo Gap { get; set; } = new();
    public DeltaInfo Delta { get; set; } = new();
}

public sealed class CardView
{
    public int ClassPos { get; set; }
    public string Driver { get; set; } = "";
    public double Last { get; set; } = -1;
    public GapInfo Gap { get; set; } = new();    // always a time
    public DeltaInfo Delta { get; set; } = new(); // your last lap minus this car's last lap (as on the leaderboard)
}

public sealed class PbInfo
{
    public string Driver { get; set; } = "";
    public double Lap { get; set; }
    public double S1 { get; set; }
    public double S2 { get; set; }
    public double S3 { get; set; }
}

public sealed class StandingsView
{
    [JsonPropertyName("class")] public string Class { get; set; } = "";
    public int Count { get; set; }
    public int FocusPos { get; set; }
    public string FocusDriver { get; set; } = "";
    public bool Driving { get; set; }            // the focus car is flagged as the player's (you are in the car)
    public bool Sep { get; set; }                // positions are skipped between P1 and the window
    public double ClassBest { get; set; }
    public double Remaining { get; set; } = -1;  // seconds left, -1 unknown
    public List<StandingRow> Rows { get; set; } = new();
    /// <summary>Every car of the class in order (only when StandingsEngine.IncludeAll): the page picks its own rows (cars ahead / behind settings).</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public List<StandingRow> All { get; set; }
    /// <summary>The other classes, each in order (only when StandingsEngine.IncludeAll): a leaderboard set to another class shows one. Gap = to that class's leader.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public List<ClassBoard> Others { get; set; }
    public CardView Ahead { get; set; }
    public CardView Behind { get; set; }
    public PbInfo Pb { get; set; } = new();
}

public sealed class ClassBoard
{
    [JsonPropertyName("class")] public string Class { get; set; } = "";
    public int Count { get; set; }
    public double ClassBest { get; set; }
    public List<StandingRow> Rows { get; set; } = new();
}

public sealed class SectorBox
{
    public double Value { get; set; } = -1;      // this lap's sector once done (S1 done), else the last lap's
    public double? Diff { get; set; }            // value minus the personal best sector
    public int Flag { get; set; }                // 1 = class best, 2 = personal best, 3 = slower, 0 = none
}

/// <summary>Fuel (litres) or virtual energy (%) of the focus car: what is left and the per-lap use (pit laps and the first partial lap are not counted).</summary>
public sealed class UsageView
{
    public double Now { get; set; } = -1;        // litres / % left
    public double Pct { get; set; } = -1;        // % of the tank (bar), fuel: fuel / capacity
    public double Avg { get; set; } = -1;        // average of the last 5 laps
    public double Last { get; set; } = -1;       // last counted lap
    public double Live { get; set; } = -1;       // estimate from this lap so far (used while there is no full lap yet)
    public double Laps { get; set; } = -1;       // laps the rest lasts (Avg, else Live)
    public double Add { get; set; } = -1;        // to add for the rest of the race (Avg, else Live), -1 = nothing / unknown
}

/// <summary>The focus car's own numbers for the car info, tyres, fuel and damage widgets (from ITS telemetry, so also while spectating).</summary>
public sealed class CarView
{
    public bool Has { get; set; }                // a focus car with telemetry
    public string Driver { get; set; } = "";
    public string Model { get; set; } = "";
    public string Entry { get; set; } = "";
    public bool InPits { get; set; }
    public double BrakeBias { get; set; } = -1;  // front %
    public int Tc { get; set; } = -1;
    public int TcSlip { get; set; } = -1;
    public int TcCut { get; set; } = -1;
    public int Abs { get; set; } = -1;
    public int Map { get; set; } = -1;
    public string Compound { get; set; } = "";
    public WheelSnap[] Wheels { get; set; } = Array.Empty<WheelSnap>();   // FL FR RL RR
    public int[] Dents { get; set; } = Array.Empty<int>();                // 8 body zones
    public bool Detached { get; set; }
    public double Body { get; set; } = -1;       // body condition 0..1 (1 - dent sum / 16)
    public double Aero { get; set; } = -1;       // aero condition 0..1 from the game's web API (your own car only), -1 = none
    public double Susp { get; set; } = -1;       // suspension condition 0..1, same source
    public double[] SuspWheels { get; set; }     // suspension damage per wheel 0..1 (FL FR RL RR), null = none
    public string Engine { get; set; } = "";     // "" fine, "overheat" (the game's flag), "off" (no revs while out on track: stalled / dead)
    public double LapsLeft { get; set; } = -1;   // race laps left (same estimate as the top bar)
    public UsageView Fuel { get; set; } = new();
    public UsageView Ve { get; set; } = new();
}

/// <summary>A car on the track map: lap fraction (the page puts it on the learned outline).</summary>
public sealed class MapDot
{
    public double F { get; set; }                // 0..1 round the lap
    public double X { get; set; }                // world position (where the dot is drawn)
    public double Z { get; set; }
    public int Pos { get; set; }                 // class position
    public bool Me { get; set; }                 // the focus car
    public bool Pit { get; set; }
    public string Cls { get; set; } = "";        // its class (the map colours by class)
}

/// <summary>Track / weather / map widget.</summary>
public sealed class TrackView
{
    public string Name { get; set; } = "";
    public double Air { get; set; }
    public double Road { get; set; }
    public double Raining { get; set; }          // 0..1
    public double Wetness { get; set; }          // 0..1
    public double TimeOfDay { get; set; } = -1;
    public double SessionLength { get; set; } = -1;   // s (mEndET; the forecast points are at 0/20/40/60/80 % of it)
    public double Elapsed { get; set; } = -1;         // s into the session
    public int MapVersion { get; set; }          // the outline (sent separately as {type:"map"}) changed when this changes
    public List<MapDot> Cars { get; set; } = new();   // the focus car's class
    public FlagView Flags { get; set; } = new();      // green / local yellow (where) / full course yellow (FlagWatch)
}

/// <summary>Top bar: the focus car's session numbers. Best / sectors are the personal bests of the DRIVER in the focus car (driving or spectating).</summary>
public sealed class TopBarView
{
    public bool Has { get; set; }                // a focus car was found
    public int Session { get; set; }             // mSession (the browser turns it into a name)
    public double TimeLeft { get; set; } = -1;   // seconds, -1 unknown
    public int ClassPos { get; set; }
    public int Overall { get; set; }
    public int Lap { get; set; }                 // the lap being driven (completed + 1)
    public double LapsLeft { get; set; } = -1;   // estimate, -1 unknown
    public double Last { get; set; } = -1;
    public int LastFlag { get; set; }            // 1 = class best, 2 = personal best
    public double? LastDiff { get; set; }        // last lap minus personal best
    public double Best { get; set; } = -1;       // personal best of the driver in the car
    public int BestFlag { get; set; }            // 1 = class best, 2 = not
    public double Cur { get; set; } = -1;        // current lap time
    public double Est { get; set; } = -1;        // the car's best + live delta
    public double? Delta { get; set; }           // live delta to the car's best (game's own)
    public List<SectorBox> Sectors { get; set; } = new();
}
