using System.Windows;
using System.Windows.Input;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace Pitwall.App;

/// <summary>An app window (the hub, Race Control): just the WebView2 showing a local page. F11 = full screen (on the monitor the window is on), F12 = developer tools, Esc leaves full screen.</summary>
public sealed class MainWindow : Window
{
    static Task<CoreWebView2Environment> sharedEnv;                                      // one browser environment for all windows
    readonly WebView2 web = new() { DefaultBackgroundColor = System.Drawing.Color.FromArgb(11, 12, 14) };
    readonly AppSettings settings; readonly WindowPlacement p; readonly string url;
    WindowStyle prevStyle; ResizeMode prevResize; WindowState prevState; bool full;

    public MainWindow(AppSettings s, WindowPlacement place, string url, string title)
    {
        settings = s; p = place; this.url = url; Title = title; Content = web; Background = System.Windows.Media.Brushes.Black;
        try { Icon = System.Windows.Media.Imaging.BitmapFrame.Create(new Uri("pack://application:,,,/app.ico")); } catch (Exception) { }   // title bar / taskbar icon
        bool onScreen = p.Left > SystemParameters.VirtualScreenLeft - 50 && p.Top > SystemParameters.VirtualScreenTop - 50 &&
                        p.Left < SystemParameters.VirtualScreenLeft + SystemParameters.VirtualScreenWidth - 100 && p.Top < SystemParameters.VirtualScreenTop + SystemParameters.VirtualScreenHeight - 100;
        if (onScreen) { Left = p.Left; Top = p.Top; Width = Math.Max(400, p.Width); Height = Math.Max(300, p.Height); }
        WindowStartupLocation = onScreen ? WindowStartupLocation.Manual : WindowStartupLocation.CenterScreen;
        if (p.Maximized) WindowState = WindowState.Maximized;
        SourceInitialized += (_, _) => DarkTitleBar();
        Loaded += async (_, _) => await Init();
        Closing += (_, _) => { SavePlacement(); var h = new System.Windows.Interop.WindowInteropHelper(this).Handle; foreach (var id in hotkeys.Keys) UnregisterHotKey(h, id); padWatcher?.Dispose(); };
        PreviewKeyDown += OnKey;
    }

    async Task Init()
    {
        try
        {
            sharedEnv ??= CoreWebView2Environment.CreateAsync(null, System.IO.Path.Combine(AppPaths.Dir, "webview"));
            var env = await sharedEnv;
            await web.EnsureCoreWebView2Async(env);
            web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            web.CoreWebView2.Settings.IsZoomControlEnabled = false;
            web.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = true;
            web.CoreWebView2.WebMessageReceived += OnMessage;                               // the page's theme colours for the title bar
            web.CoreWebView2.Navigate(url);
            if (p.Fullscreen) SetFull(true);
        }
        catch (Exception ex)
        {
            MessageBox.Show("The window could not start (is the Microsoft Edge WebView2 Runtime installed?).\n\nYou can still open " + url + " in any browser.\n\n" + ex.Message, "My LMU Hub");
        }
    }

    // the Windows title bar in the page's theme colours (at start the hub's #0B0B0C, light text) instead of the standard grey / white.
    // Windows 11 only (DWM caption / text / border colour); Windows 10 gets the dark title bar at most; errors are ignored.
    [System.Runtime.InteropServices.DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
    void DarkTitleBar() => TitleBar(0x000C0B0B, 0x00F0F3F2, false);                      // COLORREF = 0x00BBGGRR; the page sends its own colours once loaded
    void TitleBar(int caption, int text, bool light)
    {
        try
        {
            var h = new System.Windows.Interop.WindowInteropHelper(this).Handle; if (h == IntPtr.Zero) return;
            int dark = light ? 0 : 1, border = caption;
            DwmSetWindowAttribute(h, 20, ref dark, 4);                                       // DWMWA_USE_IMMERSIVE_DARK_MODE (off for a light page: dark buttons)
            DwmSetWindowAttribute(h, 35, ref caption, 4);                                    // DWMWA_CAPTION_COLOR
            DwmSetWindowAttribute(h, 36, ref text, 4);                                       // DWMWA_TEXT_COLOR
            DwmSetWindowAttribute(h, 34, ref border, 4);                                     // DWMWA_BORDER_COLOR
        }
        catch (Exception) { }
    }

    // the page sends { titleBar: "#rrggbb", titleText: "#rrggbb" } when its theme is applied or changed (hub.js / app.js): the title bar takes those colours
    void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(e.WebMessageAsJson);
            var r = doc.RootElement;
            if (r.ValueKind == System.Text.Json.JsonValueKind.Object && r.TryGetProperty("hotkeys", out var hk) && hk.ValueKind == System.Text.Json.JsonValueKind.Array)
            { SetHotkeys(hk.EnumerateArray().Select(x => x.GetString()).Where(x => !string.IsNullOrEmpty(x)).ToList()); return; }
            if (r.ValueKind == System.Text.Json.JsonValueKind.Object && r.TryGetProperty("padLearn", out var pl)) { Pads().Learn(pl.ValueKind == System.Text.Json.JsonValueKind.True); return; }
            if (r.ValueKind != System.Text.Json.JsonValueKind.Object || !r.TryGetProperty("titleBar", out var bg)) return;
            int? c = Colour(bg.GetString()), tx = r.TryGetProperty("titleText", out var t) ? Colour(t.GetString()) : null;
            if (c == null) return;
            int rr = c.Value & 0xFF, gg = (c.Value >> 8) & 0xFF, bb = (c.Value >> 16) & 0xFF;
            bool light = rr * 0.299 + gg * 0.587 + bb * 0.114 > 150;
            TitleBar(c.Value, tx ?? (light ? 0x001C1816 : 0x00F0F3F2), light);
        }
        catch (Exception) { }
    }
    // ---- global hotkeys (Race Control: a key per view, app.js): registered with Windows so they work while the game has the keyboard. A press is sent
    // back to the page as { hotkey: "Ctrl+Alt+1" }; combinations Windows refuses (another program has them) go back as { hotkeysFailed: [...] }.
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr hWnd, int id, uint mods, uint vk);
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    readonly Dictionary<int, string> hotkeys = new(); bool hooked;
    void SetHotkeys(List<string> combos)
    {
        var h = new System.Windows.Interop.WindowInteropHelper(this).Handle; if (h == IntPtr.Zero) return;
        if (!hooked) { System.Windows.Interop.HwndSource.FromHwnd(h)?.AddHook(WndProc); hooked = true; }
        foreach (var id in hotkeys.Keys) UnregisterHotKey(h, id);
        hotkeys.Clear();
        var failed = new List<string>(); int next = 0x7100;
        var pads = combos.Where(c => c.StartsWith("Pad:")).ToList();                         // wheel / button box / gamepad buttons: PadWatcher
        if (pads.Count > 0 || padWatcher != null) Pads().SetBindings(pads);
        foreach (var c in combos.Except(pads).Distinct())
        {
            if (!ParseCombo(c, out uint mods, out uint vk)) { failed.Add(c); continue; }
            int id = next++;
            if (RegisterHotKey(h, id, mods | 0x4000, vk)) hotkeys[id] = c; else failed.Add(c);   // 0x4000 = MOD_NOREPEAT
        }
        try { web.CoreWebView2?.PostWebMessageAsJson(System.Text.Json.JsonSerializer.Serialize(new { hotkeysFailed = failed })); } catch (Exception) { }
    }
    IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == 0x0312 && hotkeys.TryGetValue(wParam.ToInt32(), out var combo))              // WM_HOTKEY
        {
            try { web.CoreWebView2?.PostWebMessageAsJson(System.Text.Json.JsonSerializer.Serialize(new { hotkey = combo })); } catch (Exception) { }
            handled = true;
        }
        return IntPtr.Zero;
    }
    // controller buttons (made on first use): a press goes to the page like a key ({ hotkey }), a learned button as { padLearned, padName },
    // the controllers found when learning starts as { padDevices } (shown in the Keys panel, so a missing device can be seen)
    PadWatcher padWatcher;
    PadWatcher Pads()
    {
        if (padWatcher != null) return padWatcher;
        padWatcher = new PadWatcher();
        void Post(object o) => Dispatcher.BeginInvoke(() => { try { web.CoreWebView2?.PostWebMessageAsJson(System.Text.Json.JsonSerializer.Serialize(o)); } catch (Exception) { } });
        padWatcher.Pressed += c => Post(new { hotkey = c });
        padWatcher.Learned += (c, n) => Post(new { padLearned = c, padName = n });
        padWatcher.Seen += l => Post(new { padDevices = l });
        return padWatcher;
    }

    // "Ctrl+Alt+1" / "Shift+F5" / "Num3" / "K" -> modifiers (MOD_ALT 1, MOD_CONTROL 2, MOD_SHIFT 4) + virtual key
    internal static bool ParseCombo(string combo, out uint mods, out uint vk)
    {
        mods = 0; vk = 0;
        foreach (var part in (combo ?? "").Split('+'))
        {
            string p = part.Trim();
            if (p == "Ctrl") mods |= 2; else if (p == "Alt") mods |= 1; else if (p == "Shift") mods |= 4;
            else if (p.Length == 1 && char.IsAsciiLetterUpper(p[0])) vk = p[0];
            else if (p.Length == 1 && char.IsAsciiDigit(p[0])) vk = p[0];
            else if (p.StartsWith("Num") && p.Length == 4 && char.IsAsciiDigit(p[3])) vk = (uint)(0x60 + (p[3] - '0'));
            else if (p.StartsWith("F") && int.TryParse(p.Substring(1), out int f) && f >= 1 && f <= 24) vk = (uint)(0x70 + f - 1);
            else return false;
        }
        return vk != 0;
    }

    // "#rrggbb" -> COLORREF (0x00BBGGRR), null = not a colour
    static int? Colour(string s)
    {
        if (s == null || !System.Text.RegularExpressions.Regex.IsMatch(s, "^#[0-9a-fA-F]{6}$")) return null;
        int v = Convert.ToInt32(s.Substring(1), 16); return ((v & 0xFF) << 16) | (v & 0xFF00) | ((v >> 16) & 0xFF);
    }

    void OnKey(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.F11) { SetFull(!full); e.Handled = true; }
        else if (e.Key == Key.Escape && full) { SetFull(false); e.Handled = true; }
        else if (e.Key == Key.F12) { web.CoreWebView2?.OpenDevToolsWindow(); e.Handled = true; }
    }

    void SetFull(bool on)
    {
        if (on == full) return;
        if (on) { prevStyle = WindowStyle; prevResize = ResizeMode; prevState = WindowState; WindowStyle = WindowStyle.None; ResizeMode = ResizeMode.NoResize; WindowState = WindowState.Normal; WindowState = WindowState.Maximized; }
        else { WindowStyle = prevStyle; ResizeMode = prevResize; WindowState = prevState; }
        full = on;
    }

    void SavePlacement()
    {
        try
        {
            p.Fullscreen = full; p.Maximized = !full && WindowState == WindowState.Maximized;
            var b = WindowState == WindowState.Normal ? new Rect(Left, Top, Width, Height) : RestoreBounds;
            if (!full && !double.IsNaN(b.Left)) { p.Left = b.Left; p.Top = b.Top; p.Width = b.Width; p.Height = b.Height; }
            SettingsStore.Save(settings);
        }
        catch (Exception) { }
    }
}
