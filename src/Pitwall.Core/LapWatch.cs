namespace Pitwall.Core;

/// <summary>Sees one car's laps complete WITH their time. The lap counter (mTotalLaps) and the lap time (mLastLapTime) are separate fields that do not
/// have to change in the same reading (KNOWLEDGE: a lap = a change of mLastLapTime); reading the time at the moment the counter goes up can give the
/// PREVIOUS lap's time (the owner's new best lap never showed until a restart). So: the counter says a lap is done, the time that changes (just before or
/// after) is its time. A lap that never gets a time (the out-lap) is dropped at the next lap. Pit = the car was in the pits during that lap.</summary>
public sealed class LapWatch
{
    int laps = int.MinValue; double seen = -1, early = -1; bool pit, pending, pendingPit; int pendingLap;

    /// <summary>Start over (a new session): the next reading is a first sighting.</summary>
    public void Reset() { laps = int.MinValue; pending = false; early = -1; }

    /// <summary>Call every reading. True = a lap with a time was completed: its number, time and whether it touched the pits.</summary>
    public bool Step(int lapsNow, double last, bool inPits, out int lap, out double time, out bool pitLap)
    {
        lap = 0; time = -1; pitLap = false;
        if (laps == int.MinValue || lapsNow < laps) { laps = lapsNow; seen = last; early = -1; pit = inPits; pending = false; return false; }   // first sighting / restart
        if (inPits) pit = true;
        bool changed = Math.Abs(last - seen) > 1e-4;
        if (lapsNow > laps)
        {
            laps = lapsNow;
            if (early > 0) { lap = lapsNow; time = early; pitLap = pit; early = -1; pending = false; pit = inPits; return true; }   // the time came first
            pending = true; pendingPit = pit; pendingLap = lapsNow; pit = inPits;
        }
        if (!changed) return false;
        seen = last;
        if (last <= 0) return false;
        if (pending) { pending = false; lap = pendingLap; time = last; pitLap = pendingPit; return true; }                       // the counter came first
        early = last; return false;
    }
}
