using System.Runtime.InteropServices;
using System.Windows.Threading;

namespace MyLMUHub.App;

/// <summary>Keyboard hotkeys (Race Control: a key per view, the fuel widget's stint laps + / -) that work while the game has the keyboard. A low-level keyboard
/// hook that only LOOKS: every key still goes on to the game and other programs (owner 2026-11-15: RegisterHotKey, used before, took the key away from
/// everything else, and Windows refused keys another program had). Installed only while a key is bound, on its own thread (so a busy window never slows typing);
/// a press of a bound combination (exactly these modifiers, not held down / repeated) raises Pressed.</summary>
public sealed class KeyWatcher : IDisposable
{
    delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr module, uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
    const int WH_KEYBOARD_LL = 13, WM_KEYDOWN = 0x100, WM_KEYUP = 0x101, WM_SYSKEYDOWN = 0x104, WM_SYSKEYUP = 0x105;

    readonly object gate = new();
    Dictionary<(uint Mods, uint Vk), string> bound = new();
    readonly HashSet<uint> down = new();                                                        // keys held now (a held key repeats: one press only)
    readonly HookProc proc;
    IntPtr hook; Dispatcher thread;

    /// <summary>A bound combination was pressed ("Ctrl+Alt+1").</summary>
    public event Action<string> Pressed;

    public KeyWatcher() { proc = Hook; }

    /// <summary>The combinations to watch; the ones that cannot be read come back (not a key this app knows).</summary>
    public List<string> SetBindings(IEnumerable<string> combos)
    {
        var map = new Dictionary<(uint, uint), string>(); var bad = new List<string>();
        foreach (var c in combos.Distinct()) { if (MainWindow.ParseCombo(c, out uint m, out uint vk)) map[(m, vk)] = c; else bad.Add(c); }
        lock (gate) bound = map;
        bool want = map.Count > 0;
        if (want || thread != null) Thread().BeginInvoke(() =>
        {
            if (want && hook == IntPtr.Zero) hook = SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(null), 0);
            else if (!want && hook != IntPtr.Zero) { UnhookWindowsHookEx(hook); hook = IntPtr.Zero; down.Clear(); }
        });
        return bad;
    }

    Dispatcher Thread()
    {
        lock (gate)
        {
            if (thread != null) return thread;
            using var ready = new ManualResetEventSlim();
            var t = new Thread(() => { thread = Dispatcher.CurrentDispatcher; ready.Set(); Dispatcher.Run(); }) { IsBackground = true, Name = "keyboard" };
            t.Start(); ready.Wait();
            return thread;
        }
    }

    IntPtr Hook(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0)
            try
            {
                int msg = wParam.ToInt32(); uint vk = (uint)Marshal.ReadInt32(lParam);
                if (msg == WM_KEYUP || msg == WM_SYSKEYUP) down.Remove(vk);
                else if ((msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN) && down.Add(vk))
                {
                    uint mods = (Held(0x12) ? 1u : 0) | (Held(0x11) ? 2u : 0) | (Held(0x10) ? 4u : 0);  // Alt, Ctrl, Shift (either side)
                    string combo; lock (gate) bound.TryGetValue((mods, vk), out combo);
                    if (combo != null) Pressed?.Invoke(combo);
                }
            }
            catch (Exception) { }
        return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);                                // always passed on: the key is never taken
    }
    static bool Held(int vk) => (GetAsyncKeyState(vk) & 0x8000) != 0;

    public void Dispose()
    {
        var t = thread; if (t == null) return;
        try { t.Invoke(() => { if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook); hook = IntPtr.Zero; }); t.InvokeShutdown(); } catch (Exception) { }
    }
}
