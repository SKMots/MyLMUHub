using System.Windows.Forms;

namespace MyLMUHub.App;

/// <summary>The icon in the taskbar's notification area (settings CloseToTray): closing the last window keeps the app running (live data, team sharing,
/// hotkeys) without a window; a click opens the hub, right-click = Open / Race Control / Quit. Only there while the setting is on.</summary>
public sealed class Tray : IDisposable
{
    NotifyIcon icon;
    readonly Action openHub, openRc, quit;
    public Tray(Action openHub, Action openRc, Action quit) { this.openHub = openHub; this.openRc = openRc; this.quit = quit; }

    public void Show(bool on)
    {
        if (!on) { if (icon != null) { icon.Visible = false; icon.Dispose(); icon = null; } return; }
        if (icon != null) return;
        System.Drawing.Icon ico;
        try { ico = System.Drawing.Icon.ExtractAssociatedIcon(Environment.ProcessPath); } catch (Exception) { ico = System.Drawing.SystemIcons.Application; }
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open My LMU Hub", null, (_, _) => openHub());
        menu.Items.Add("Open Race Control", null, (_, _) => openRc());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quit My LMU Hub", null, (_, _) => quit());
        icon = new NotifyIcon { Icon = ico, Text = "My LMU Hub", ContextMenuStrip = menu, Visible = true };
        icon.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) openHub(); };
    }

    /// <summary>A short note the first time the app stays in the tray.</summary>
    public void Note(string text) { try { icon?.ShowBalloonTip(4000, "My LMU Hub", text, ToolTipIcon.None); } catch (Exception) { } }

    public void Dispose() => Show(false);
}
