using System.Windows;
using MyLMUHub.Core;

namespace MyLMUHub.App;

public static class Program
{
    const string Help = @"My LMU Hub
  --replay <file>   play back a recorded snapshot instead of the live game (a .json snapshot / array of snapshots, or a .bin memory image)
  --focus <name>    add a driver name to follow for this run (part of the name is enough)
  --port <n>        local web port (default from settings, 8765)
  --www <folder>    serve the web files from this folder (handy while developing the page)
  --help
Settings: %AppData%\MyLMUHub\settings.json   Layout (views + theme): %AppData%\MyLMUHub\layout.json   Spectate choice: spectate.json
Keys in the window: F11 full screen, F12 developer tools, E edit the layout (inside the page).";

    [STAThread]
    public static int Main(string[] args)
    {
        string replay = null, www = null; int port = 0; var extraFocus = new List<string>();
        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            if (a == "--help" || a == "-h" || a == "/?") { MessageBox.Show(Help, "My LMU Hub"); return 0; }
            if (a == "--replay" && i + 1 < args.Length) replay = args[++i];
            else if (a == "--focus" && i + 1 < args.Length) extraFocus.Add(args[++i]);
            else if (a == "--port" && i + 1 < args.Length) int.TryParse(args[++i], out port);
            else if (a == "--www" && i + 1 < args.Length) www = args[++i];
        }
        UpdateService.AfterStart(args);                                                          // after an update: the old copy closes first (the port), its exe is removed

        // --port / --focus apply to this run only: 'settings' is saved again on exit (window placement), so they must not be put into it
        var settings = SettingsStore.Load();
        int usePort = port > 0 ? port : settings.Port;
        var catalog = Catalog.LoadEmbedded();
        ISnapshotSource source;
        try
        {
            if (replay == null) source = new LiveSource(catalog);
            else if (replay.EndsWith(".bin", StringComparison.OrdinalIgnoreCase)) source = new ImageFileSource(catalog, replay);
            else source = new JsonReplaySource(replay);
        }
        catch (Exception ex) { MessageBox.Show("Cannot open the replay file:\n" + ex.Message, "My LMU Hub"); return 1; }

        var server = new DashServer(usePort, www ?? System.IO.Path.Combine(AppContext.BaseDirectory, "wwwroot"), AppPaths.Layout) { StrategyPath = AppPaths.Strategy, VeGoalsPath = AppPaths.VeGoals, StrategyLivePath = AppPaths.StrategyLive, HotkeyStatusPath = AppPaths.HotkeyStatus };
        try { server.Start(); }
        catch (Exception ex) { MessageBox.Show($"Cannot start the local web server on port {usePort}.\nIs another copy already running?\n\n{ex.Message}", "My LMU Hub"); return 1; }
        if (settings.LanAccess && port == 0) server.SetLan(true);                                // network access (no prompt here: a refused one shows in the page)
        server.LanSaved = on => { settings.LanAccess = on; SettingsStore.Save(settings); };

        // settings.json is re-read when it changes, so focus names can be edited while the app runs (the window saves 'settings' on exit: keep its names current)
        DateTime stamp = SettingsStore.Stamp(); var focus = extraFocus.Concat(settings.FocusNames).ToList();
        List<string> FocusNames()
        {
            var st = SettingsStore.Stamp();
            if (st != stamp) { stamp = st; settings.FocusNames = SettingsStore.Load().FocusNames; focus = extraFocus.Concat(settings.FocusNames).ToList(); }
            return focus;
        }
        var engine = new StandingsEngine(focus) { Spectate = SpectateStore.Load(), IncludeAll = true };
        var web = replay == null ? new GameWebApi(AppPaths.Dir) : null; web?.Start();             // the game's web API only exists live
        var pens = replay == null ? new LivePenalties(AppPaths.Dir) : null; pens?.Start();       // penalty kinds: the game's UI websocket, live only
        var pump = new DataPump(source, engine, server, FocusNames, web) { Penalties = pens }; pump.Start();
        server.SpectateInfo = () => new { target = engine.Spectate, cars = pump.Cars() };
        server.RaceLive = pump.RaceLive;
        server.SpectateSet = t => { engine.Spectate = t; SpectateStore.Save(t); };

        var pace = new PaceService(settings);
        server.PaceInfo = pace.Info; pump.Pace = pace;
        server.PaceSet = pace.Set;
        server.CarLaps = pace.CarLaps;
        var segments = new SegmentStore(); pump.Segments = replay == null ? segments : null; server.Segments = segments.Info; server.SegmentLine = segments.Line;   // segment times: only from the live game
        var guests = new Guests(settings); pace.Guests = guests; segments.Guest = () => guests.Current;   // guest mode: a friend's data apart from yours
        guests.Changed += () => { pace.GuestChanged(); segments.Bump(); };
        server.GuestInfo = () => guests.Info(pace.GuestFiles);
        server.GuestDo = (what, name) => { if (what == "start") guests.Start(name); else if (what == "stop") guests.Stop(); else if (what == "delete") guests.Delete(name, pace.Folder, pace.HandGiven(name)); };
        server.SessionsInfo = pace.Files; server.SessionsDo = pace.Manage;                   // My sessions page: hide / give to a guest / delete result files
        server.Coach = new CoachService();                                                       // AI Coach: the user's own API key, asked only on a click
        var twitch = new TwitchViewers(); server.Twitch = twitch.Get;                            // viewer count for the Twitch chat widget
        var updates = new UpdateService();
        server.UpdateInfo = updates.Info; server.UpdateDo = what => { if (what == "check") _ = updates.Check(); else if (what == "install") updates.Install(); };
        server.Reference = new ReferenceTimes(www ?? System.IO.Path.Combine(AppContext.BaseDirectory, "wwwroot")).Get;

        // Only the hub (home, Race Pace) opens at start. Race Control (the dashboard) is its own window, opened from the hub, so it can sit full screen on
        // another monitor; either window can be closed while the other stays open (a closed window's browser process ends: less to run). The app ends with the last window.
        // Each window saves 'settings' (its placement) on close.
        var app = new Application { ShutdownMode = ShutdownMode.OnLastWindowClose };
        MainWindow rc = null, hub = null;
        MainWindow Show(MainWindow w, WindowPlacement place, string page, string title, Action closed)
        {
            if (w != null) { if (w.WindowState == WindowState.Minimized) w.WindowState = WindowState.Normal; w.Activate(); return w; }
            w = new MainWindow(settings, place, server.Url + page, title); w.Closed += (_, _) => closed();
            w.Show(); return w;
        }
        void OpenRaceControl() => rc = Show(rc, settings.Window, "index.html", "My LMU Hub - Race Control", () => rc = null);
        void OpenHub() => hub = Show(hub, settings.HubWindow, "home.html", "My LMU Hub", () => hub = null);
        // an extra Race Control window per view (another monitor): index.html?view=<name>; its place is kept per view
        var extra = new Dictionary<string, MainWindow>();
        void OpenView(string view)
        {
            extra.TryGetValue(view, out var w);
            settings.ViewWindows ??= new();
            if (!settings.ViewWindows.TryGetValue(view, out var place)) settings.ViewWindows[view] = place = new WindowPlacement { Left = settings.Window.Left + 60, Top = settings.Window.Top + 60, Width = settings.Window.Width, Height = settings.Window.Height };
            extra[view] = Show(w, place, "index.html?view=" + Uri.EscapeDataString(view), "My LMU Hub - " + view, () => extra.Remove(view));
        }
        server.Open = (what, view) => app.Dispatcher.BeginInvoke(() =>
        {
            if (what == "racecontrol" && view.Length > 0) OpenView(view);
            else if (what == "racecontrol") OpenRaceControl(); else if (what == "hub") OpenHub();
        });
        updates.Restart = () => app.Dispatcher.BeginInvoke(() => app.Shutdown());              // the new version is already starting
        app.Startup += (_, _) => OpenHub();
        app.Run();
        pump.Dispose(); pens?.Dispose(); server.Dispose(); updates.Dispose(); twitch.Dispose();
        return 0;
    }
}
