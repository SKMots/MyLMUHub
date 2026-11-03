using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace Pitwall.App;

/// <summary>Buttons of game controllers (wheel, button box, gamepad) for the view hotkeys, read with Windows' joystick API (winmm, built in: no driver, works
/// while the game has the focus; up to 16 devices x 32 buttons). A button is named "Pad:VVVV-PPPP:B12" (USB vendor / product id + button number), so it
/// still works when Windows numbers the devices differently. Runs only while a button is bound or one is being learned (20 readings a second).</summary>
public sealed class PadWatcher : IDisposable
{
    [StructLayout(LayoutKind.Sequential)]
    struct JOYINFOEX { public int dwSize, dwFlags, dwXpos, dwYpos, dwZpos, dwRpos, dwUpos, dwVpos, dwButtons, dwButtonNumber, dwPOV, dwReserved1, dwReserved2; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct JOYCAPSW
    {
        public ushort wMid, wPid; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szPname;
        public uint wXmin, wXmax, wYmin, wYmax, wZmin, wZmax, wNumButtons, wPeriodMin, wPeriodMax, wRmin, wRmax, wUmin, wUmax, wVmin, wVmax, wCaps, wMaxAxes, wNumAxes, wMaxButtons;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szRegKey; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szOEMVxD;
    }
    [DllImport("winmm.dll")] static extern int joyGetPosEx(int id, ref JOYINFOEX info);
    [DllImport("winmm.dll", CharSet = CharSet.Unicode)] static extern int joyGetDevCapsW(IntPtr id, ref JOYCAPSW caps, int size);
    const int JOY_RETURNBUTTONS = 0x80, Devices = 16;

    readonly object gate = new();
    readonly Timer timer;
    readonly int[] last = new int[Devices];
    readonly string[] ids = new string[Devices], names = new string[Devices];
    HashSet<string> bound = new();
    bool learning, running; DateTime nextScan;

    /// <summary>A bound button was pressed (combo).</summary>
    public event Action<string> Pressed;
    /// <summary>While learning: the first button pressed (combo, device name).</summary>
    public event Action<string, string> Learned;

    public PadWatcher() { timer = new Timer(_ => Tick(), null, Timeout.Infinite, Timeout.Infinite); }

    public void SetBindings(IEnumerable<string> combos) { lock (gate) { bound = new HashSet<string>(combos.Where(c => c.StartsWith("Pad:"))); Run(); } }
    // learning starts from what is held now (a button already down is not the answer): every device is seen afresh
    public void Learn(bool on) { lock (gate) { learning = on; Array.Fill(ids, null); nextScan = DateTime.MinValue; Run(); } }

    void Run()
    {
        bool want = learning || bound.Count > 0;
        if (want == running) return;
        running = want; timer.Change(want ? 0 : Timeout.Infinite, want ? 50 : Timeout.Infinite);
    }

    void Tick()
    {
        try
        {
            if (DateTime.UtcNow >= nextScan) { Scan(); nextScan = DateTime.UtcNow.AddSeconds(5); }   // devices plugged in / out
            for (int i = 0; i < Devices; i++)
            {
                if (ids[i] == null) continue;
                var info = new JOYINFOEX { dwSize = Marshal.SizeOf<JOYINFOEX>(), dwFlags = JOY_RETURNBUTTONS };
                if (joyGetPosEx(i, ref info) != 0) { ids[i] = null; continue; }
                int now = info.dwButtons, down = now & ~last[i]; last[i] = now;
                for (int b = 0; b < 32 && down != 0; b++)
                {
                    if ((down & (1 << b)) == 0) continue;
                    string combo = "Pad:" + ids[i] + ":B" + (b + 1);
                    bool learn, isBound; lock (gate) { learn = learning; isBound = bound.Contains(combo); if (learn) learning = false; }
                    if (learn) { Learned?.Invoke(combo, names[i] + " · button " + (b + 1)); lock (gate) Run(); return; }
                    if (isBound) Pressed?.Invoke(combo);
                }
            }
        }
        catch (Exception) { }
    }

    // which joystick ids are connected: their USB vendor / product id and a readable name (the device's own name from the registry, else Windows')
    void Scan()
    {
        for (int i = 0; i < Devices; i++)
        {
            var caps = new JOYCAPSW();
            var info = new JOYINFOEX { dwSize = Marshal.SizeOf<JOYINFOEX>(), dwFlags = JOY_RETURNBUTTONS };
            if (joyGetDevCapsW((IntPtr)i, ref caps, Marshal.SizeOf<JOYCAPSW>()) != 0 || joyGetPosEx(i, ref info) != 0) { ids[i] = null; continue; }
            string id = caps.wMid.ToString("X4") + "-" + caps.wPid.ToString("X4");
            if (ids[i] != id) last[i] = info.dwButtons;                                        // a newly seen device: what is held now is not a press
            ids[i] = id; names[i] = OemName(caps.wMid, caps.wPid) ?? (string.IsNullOrWhiteSpace(caps.szPname) ? "Controller " + id : caps.szPname.Trim());
        }
    }

    static string OemName(ushort vid, ushort pid)
    {
        try
        {
            using var k = Registry.CurrentUser.OpenSubKey($@"System\CurrentControlSet\Control\MediaProperties\PrivateProperties\Joystick\OEM\VID_{vid:X4}&PID_{pid:X4}");
            var n = k?.GetValue("OEMName") as string;
            return string.IsNullOrWhiteSpace(n) ? null : n.Trim();
        }
        catch (Exception) { return null; }
    }

    public void Dispose() { timer.Dispose(); }
}
