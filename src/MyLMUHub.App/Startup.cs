using Microsoft.Win32;

namespace MyLMUHub.App;

/// <summary>Start with Windows (settings StartWithWindows, on by default, owner 2026-11-17): an entry in the user's own Run list
/// (HKCU\Software\Microsoft\Windows\CurrentVersion\Run, no admin rights) that starts this exe with --startup: the app then starts quietly in the tray
/// (no window), reading the game, syncing the team and sharing live data; a click on the tray icon opens the hub. Off = the entry is removed.
/// Written at every start (so a moved exe or an update keeps the right path); never for a build run from its bin folder (development) or a test run.</summary>
public static class Startup
{
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run", Name = "MyLMUHub";

    public static bool DevBuild(string exe) => string.IsNullOrEmpty(exe) || exe.Contains(@"\bin\", StringComparison.OrdinalIgnoreCase);

    public static void Apply(bool on)
    {
        try
        {
            var exe = Environment.ProcessPath;
            using var k = Registry.CurrentUser.OpenSubKey(RunKey, writable: true) ?? Registry.CurrentUser.CreateSubKey(RunKey);
            if (k == null) return;
            if (on && !DevBuild(exe)) k.SetValue(Name, "\"" + exe + "\" --startup");
            else if (!on) k.DeleteValue(Name, throwOnMissingValue: false);
        }
        catch (Exception) { }                                                                   // a locked-down PC: the app just does not start by itself
    }
}
