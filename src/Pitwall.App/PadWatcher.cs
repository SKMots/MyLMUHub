using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Interop;
using System.Windows.Threading;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace Pitwall.App;

/// <summary>Buttons and hats (d-pads) of game controllers (wheels, button boxes, gamepads, ...) for the view hotkeys, read with Windows' Raw Input (built in:
/// no driver; RIDEV_INPUTSINK = also while the game has the focus). Every connected controller, every button (also above 32: winmm, used before v1.0.9, saw
/// only 32 buttons and not always every device). A button is named "Pad:VVVV-PPPP:B12" (USB vendor / product id + HID button number, the same names as
/// before), a hat "Pad:VVVV-PPPP:H1-Up"; a second identical device gets "#2" after the id. Listens only while a button is bound or one is being learned
/// (registered then, removed after), on its own thread: the reports come to a hidden message-only window, no polling.</summary>
public sealed class PadWatcher : IDisposable
{
    [StructLayout(LayoutKind.Sequential)] struct RAWINPUTDEVICE { public ushort UsagePage, Usage; public uint Flags; public IntPtr Target; }
    [StructLayout(LayoutKind.Sequential)] struct RAWINPUTHEADER { public uint Type, Size; public IntPtr Device, WParam; }
    [StructLayout(LayoutKind.Sequential)] struct RAWINPUTDEVICELIST { public IntPtr Device; public uint Type; }
    [DllImport("user32.dll", SetLastError = true)] static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] devices, uint count, uint size);
    [DllImport("user32.dll")] static extern uint GetRawInputData(IntPtr rawInput, uint command, IntPtr data, ref uint size, uint headerSize);
    [DllImport("user32.dll", EntryPoint = "GetRawInputDeviceInfoW")] static extern uint GetRawInputDeviceInfo(IntPtr device, uint command, IntPtr data, ref uint size);
    [DllImport("user32.dll")] static extern uint GetRawInputDeviceList([Out] RAWINPUTDEVICELIST[] list, ref uint count, uint size);
    [DllImport("hid.dll")] static extern int HidP_GetUsages(int reportType, ushort usagePage, ushort link, [Out] ushort[] usages, ref uint length, IntPtr preparsed, IntPtr report, uint reportLength);
    [DllImport("hid.dll")] static extern uint HidP_MaxUsageListLength(int reportType, ushort usagePage, IntPtr preparsed);
    [DllImport("hid.dll")] static extern int HidP_GetCaps(IntPtr preparsed, byte[] caps);
    [DllImport("hid.dll")] static extern int HidP_GetValueCaps(int reportType, byte[] caps, ref ushort length, IntPtr preparsed);
    [DllImport("hid.dll")] static extern int HidP_GetUsageValue(int reportType, ushort usagePage, ushort link, ushort usage, out uint value, IntPtr preparsed, IntPtr report, uint reportLength);
    [DllImport("hid.dll")] static extern bool HidD_GetProductString(SafeFileHandle device, byte[] buffer, uint length);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);

    const uint RIDEV_REMOVE = 0x1, RIDEV_INPUTSINK = 0x100, RID_INPUT = 0x10000003, RIM_TYPEHID = 2;
    const uint RIDI_PREPARSEDDATA = 0x20000005, RIDI_DEVICENAME = 0x20000007, RIDI_DEVICEINFO = 0x2000000b;
    const int WM_INPUT = 0x00FF, HidP_Input = 0, HIDP_STATUS_SUCCESS = 0x00110000, MaxButton = 1024;
    static readonly ushort[] Kinds = { 0x04, 0x05, 0x08 };                                   // Generic Desktop: joystick, gamepad, multi-axis (wheels, button boxes, pads)
    static readonly string[] Hat8 = { "Up", "Up-Right", "Right", "Down-Right", "Down", "Down-Left", "Left", "Up-Left" }, Hat4 = { "Up", "Right", "Down", "Left" };

    sealed class Dev
    {
        public string Id, Name; public IntPtr Pre; public ushort[] Usages; public int Buttons;
        public readonly bool[] Down = new bool[MaxButton]; public int[] Held = new int[64]; public int HeldCount;
        public readonly List<(ushort Link, int Min, int Max)> Hats = new(); public int[] HatDir = Array.Empty<int>();
        public bool Fresh = true;                                                              // the next report is the starting point (what is held then is no press)
    }

    readonly object gate = new();
    readonly Dictionary<IntPtr, Dev> devs = new();                                             // only touched on the pad thread
    HashSet<string> bound = new();
    bool learning, registered;
    Dispatcher pad; HwndSource window; IntPtr buffer; int bufferSize;

    /// <summary>A bound button was pressed (combo).</summary>
    public event Action<string> Pressed;
    /// <summary>While learning: the first button pressed (combo, device name).</summary>
    public event Action<string, string> Learned;
    /// <summary>When learning starts: the controllers Windows shows (name, buttons, hats) - so a missing device can be seen.</summary>
    public event Action<List<string>> Seen;

    public void SetBindings(IEnumerable<string> combos) { lock (gate) { bound = new HashSet<string>(combos.Where(c => c.StartsWith("Pad:"))); } Run(); }
    // learning starts from what is held now (a button already down is not the answer): every device starts afresh
    public void Learn(bool on)
    {
        lock (gate) learning = on;
        Run();
        if (on) Pad().BeginInvoke(() => { Scan(); foreach (var d in devs.Values) d.Fresh = true; Seen?.Invoke(devs.Values.Select(Describe).ToList()); });
    }

    static string Describe(Dev d) => d.Name + " (" + d.Buttons + " buttons" + (d.Hats.Count > 0 ? ", " + d.Hats.Count + " hat" + (d.Hats.Count > 1 ? "s" : "") : "") + ")";

    void Run()
    {
        bool want; lock (gate) want = learning || bound.Count > 0;
        if (!want && pad == null) return;
        Pad().BeginInvoke(() =>
        {
            if (want == registered) return;
            var r = Kinds.Select(u => new RAWINPUTDEVICE { UsagePage = 0x01, Usage = u, Flags = want ? RIDEV_INPUTSINK : RIDEV_REMOVE, Target = want ? window.Handle : IntPtr.Zero }).ToArray();
            if (RegisterRawInputDevices(r, (uint)r.Length, (uint)Marshal.SizeOf<RAWINPUTDEVICE>())) registered = want;
            if (want) Scan();
        });
    }

    // the pad thread: a hidden message-only window that receives the controllers' reports (WM_INPUT); made on first use
    Dispatcher Pad()
    {
        lock (gate)
        {
            if (pad != null) return pad;
            using var ready = new ManualResetEventSlim();
            var t = new Thread(() =>
            {
                window = new HwndSource(new HwndSourceParameters("MyLMUHub controllers") { ParentWindow = new IntPtr(-3), WindowStyle = 0, Width = 0, Height = 0 });
                window.AddHook(Hook);
                pad = Dispatcher.CurrentDispatcher; ready.Set();
                Dispatcher.Run();
            }) { IsBackground = true, Name = "controllers" };
            t.SetApartmentState(ApartmentState.STA); t.Start(); ready.Wait();
            return pad;
        }
    }

    IntPtr Hook(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == WM_INPUT) try { Input(lParam); } catch (Exception) { }
        return IntPtr.Zero;
    }

    void Input(IntPtr raw)
    {
        uint size = 0, hdr = (uint)Marshal.SizeOf<RAWINPUTHEADER>();
        GetRawInputData(raw, RID_INPUT, IntPtr.Zero, ref size, hdr);
        if (size == 0) return;
        if (size > bufferSize) { if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer); buffer = Marshal.AllocHGlobal((int)size); bufferSize = (int)size; }
        if (GetRawInputData(raw, RID_INPUT, buffer, ref size, hdr) != size) return;
        var h = Marshal.PtrToStructure<RAWINPUTHEADER>(buffer);
        if (h.Type != RIM_TYPEHID) return;
        if (!devs.TryGetValue(h.Device, out var d)) { d = Add(h.Device); if (d == null) return; }      // plugged in after the scan
        uint each = (uint)Marshal.ReadInt32(buffer, (int)hdr), count = (uint)Marshal.ReadInt32(buffer, (int)hdr + 4);
        for (uint i = 0; i < count; i++) Report(d, buffer + (int)hdr + 8 + (int)(i * each), each);
    }

    void Report(Dev d, IntPtr report, uint length)
    {
        bool fresh = d.Fresh; d.Fresh = false;
        if (d.Usages != null)
        {
            uint n = (uint)d.Usages.Length;
            if (HidP_GetUsages(HidP_Input, 0x09, 0, d.Usages, ref n, d.Pre, report, length) == HIDP_STATUS_SUCCESS)
            {
                for (int i = 0; i < n; i++) { int b = d.Usages[i]; if (b < MaxButton && !d.Down[b] && !fresh) Fire(d, "B" + b, "button " + b); }
                for (int i = 0; i < d.HeldCount; i++) d.Down[d.Held[i]] = false;
                if (d.Held.Length < n) d.Held = new int[n];
                d.HeldCount = 0;
                for (int i = 0; i < n; i++) { int b = d.Usages[i]; if (b < MaxButton) { d.Down[b] = true; d.Held[d.HeldCount++] = b; } }
            }
        }
        for (int k = 0; k < d.Hats.Count; k++)
        {
            var (link, min, max) = d.Hats[k];
            if (HidP_GetUsageValue(HidP_Input, 0x01, link, 0x39, out uint v, d.Pre, report, length) != HIDP_STATUS_SUCCESS) continue;
            int dir = v >= min && v <= max ? (int)v - min : -1, positions = max - min + 1;
            if (dir == d.HatDir[k]) continue;
            d.HatDir[k] = dir;
            if (dir < 0 || fresh) continue;
            string name = positions >= 8 ? Hat8[dir % 8] : Hat4[dir % 4];
            Fire(d, "H" + (k + 1) + "-" + name, "hat " + (k + 1) + " " + name.ToLowerInvariant());
        }
    }

    void Fire(Dev d, string part, string what)
    {
        string combo = "Pad:" + d.Id + ":" + part;
        bool learn, isBound; lock (gate) { learn = learning; isBound = bound.Contains(combo); if (learn) learning = false; }
        if (learn) { Learned?.Invoke(combo, d.Name + " · " + what); Run(); return; }
        if (isBound) Pressed?.Invoke(combo);
    }

    // every game controller Windows shows now, in a fixed order (device path), so two identical devices keep their #2 between starts
    void Scan()
    {
        uint n = 0, sz = (uint)Marshal.SizeOf<RAWINPUTDEVICELIST>();
        GetRawInputDeviceList(null, ref n, sz);
        if (n == 0) return;
        var list = new RAWINPUTDEVICELIST[n];
        if (GetRawInputDeviceList(list, ref n, sz) == uint.MaxValue) return;
        foreach (var e in list.Take((int)n).Where(e => e.Type == RIM_TYPEHID && !devs.ContainsKey(e.Device)).Select(e => (e.Device, Path: DeviceName(e.Device))).OrderBy(e => e.Path, StringComparer.OrdinalIgnoreCase))
            Add(e.Device);
    }

    Dev Add(IntPtr device)
    {
        // which device: USB vendor / product id + its usage (only game controllers)
        uint size = 32; var info = Marshal.AllocHGlobal(32);
        try
        {
            Marshal.WriteInt32(info, 32);
            if (GetRawInputDeviceInfo(device, RIDI_DEVICEINFO, info, ref size) == uint.MaxValue || Marshal.ReadInt32(info, 4) != RIM_TYPEHID) return null;
            int vid = Marshal.ReadInt32(info, 8) & 0xFFFF, pid = Marshal.ReadInt32(info, 12) & 0xFFFF;
            ushort page = (ushort)Marshal.ReadInt16(info, 20), usage = (ushort)Marshal.ReadInt16(info, 22);
            if (page != 0x01 || Array.IndexOf(Kinds, usage) < 0) return null;
            uint ps = 0; GetRawInputDeviceInfo(device, RIDI_PREPARSEDDATA, IntPtr.Zero, ref ps);
            if (ps == 0) return null;
            var pre = Marshal.AllocHGlobal((int)ps);
            if (GetRawInputDeviceInfo(device, RIDI_PREPARSEDDATA, pre, ref ps) == uint.MaxValue) { Marshal.FreeHGlobal(pre); return null; }
            string vp = vid.ToString("X4") + "-" + pid.ToString("X4"), path = DeviceName(device);
            int same = devs.Values.Count(x => x.Id == vp || x.Id.StartsWith(vp + "#"));
            var d = new Dev { Id = same == 0 ? vp : vp + "#" + (same + 1), Pre = pre };
            d.Name = (Product(path) ?? OemName(vid, pid) ?? "Controller " + vp) + (same == 0 ? "" : " #" + (same + 1));
            uint max = HidP_MaxUsageListLength(HidP_Input, 0x09, pre);
            if (max > 0) d.Usages = new ushort[max];
            d.Buttons = (int)max;
            Hats(d);
            devs[device] = d;
            return d;
        }
        finally { Marshal.FreeHGlobal(info); }
    }

    // hat switches (usage 0x39 on Generic Desktop) from the value caps (HIDP_VALUE_CAPS = 72 bytes: page 0, link 6, IsRange 12, logical min/max 40/44, usage / min / max 56/58)
    static void Hats(Dev d)
    {
        var caps = new byte[64];
        if (HidP_GetCaps(d.Pre, caps) != HIDP_STATUS_SUCCESS) return;
        ushort n = BitConverter.ToUInt16(caps, 48);
        if (n == 0) return;
        var vc = new byte[72 * n];
        if (HidP_GetValueCaps(HidP_Input, vc, ref n, d.Pre) != HIDP_STATUS_SUCCESS) return;
        for (int i = 0; i < n; i++)
        {
            int o = i * 72;
            bool range = vc[o + 12] != 0;
            ushort page = BitConverter.ToUInt16(vc, o), lo = BitConverter.ToUInt16(vc, o + 56), hi = range ? BitConverter.ToUInt16(vc, o + 58) : lo;
            if (page == 0x01 && lo <= 0x39 && 0x39 <= hi) d.Hats.Add((BitConverter.ToUInt16(vc, o + 6), BitConverter.ToInt32(vc, o + 40), BitConverter.ToInt32(vc, o + 44)));
        }
        d.HatDir = Enumerable.Repeat(-1, d.Hats.Count).ToArray();
    }

    static string DeviceName(IntPtr device)
    {
        uint chars = 0; GetRawInputDeviceInfo(device, RIDI_DEVICENAME, IntPtr.Zero, ref chars);
        if (chars == 0) return "";
        var p = Marshal.AllocHGlobal((int)chars * 2);
        try { return GetRawInputDeviceInfo(device, RIDI_DEVICENAME, p, ref chars) == uint.MaxValue ? "" : Marshal.PtrToStringUni(p) ?? ""; }
        finally { Marshal.FreeHGlobal(p); }
    }

    // the device's own name (as Windows' game controller settings show it)
    static string Product(string path)
    {
        if (string.IsNullOrEmpty(path)) return null;
        try
        {
            using var h = CreateFileW(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
            if (h.IsInvalid) return null;
            var b = new byte[256];
            if (!HidD_GetProductString(h, b, (uint)b.Length)) return null;
            var s = Encoding.Unicode.GetString(b); int z = s.IndexOf('\0'); if (z >= 0) s = s[..z];
            return string.IsNullOrWhiteSpace(s) ? null : s.Trim();
        }
        catch (Exception) { return null; }
    }

    static string OemName(int vid, int pid)
    {
        try
        {
            using var k = Registry.CurrentUser.OpenSubKey($@"System\CurrentControlSet\Control\MediaProperties\PrivateProperties\Joystick\OEM\VID_{vid:X4}&PID_{pid:X4}");
            var n = k?.GetValue("OEMName") as string;
            return string.IsNullOrWhiteSpace(n) ? null : n.Trim();
        }
        catch (Exception) { return null; }
    }

    public void Dispose()
    {
        var p = pad; if (p == null) return;
        try
        {
            p.Invoke(() =>
            {
                if (registered) { var r = Kinds.Select(u => new RAWINPUTDEVICE { UsagePage = 0x01, Usage = u, Flags = RIDEV_REMOVE }).ToArray(); RegisterRawInputDevices(r, (uint)r.Length, (uint)Marshal.SizeOf<RAWINPUTDEVICE>()); }
                foreach (var d in devs.Values) Marshal.FreeHGlobal(d.Pre);
                devs.Clear(); if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer); buffer = IntPtr.Zero;
                window.Dispose();
            });
            p.InvokeShutdown();
        }
        catch (Exception) { }
    }
}
