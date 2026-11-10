using System.ComponentModel;
using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace MyLMUHub.App;

/// <summary>Network access (settings LanAccess): the same pages for other PCs / tablets on your home network at http://&lt;this PC's address&gt;:&lt;port&gt;/.
/// Windows only lets a program take a port for the whole network after a one-time permission (an admin prompt): a URL reservation for the port
/// (everyone may use it) and a firewall opening for PRIVATE networks only (home / work, not public Wi-Fi). Both stay until removed with netsh.</summary>
public static class LanAccess
{
    public static string Prefix(int port) => $"http://+:{port}/";

    /// <summary>This PC's addresses on the home network (IPv4, adapters that are up and have a gateway; virtual adapters usually have none).</summary>
    public static List<string> Addresses()
    {
        var all = new List<string>(); var withGw = new List<string>();
        try
        {
            foreach (var n in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (n.OperationalStatus != OperationalStatus.Up || n.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel) continue;
                var ip = n.GetIPProperties(); bool gw = ip.GatewayAddresses.Any(g => g.Address.AddressFamily == AddressFamily.InterNetwork && !g.Address.Equals(System.Net.IPAddress.Any));
                foreach (var a in ip.UnicastAddresses)
                {
                    if (a.Address.AddressFamily != AddressFamily.InterNetwork || System.Net.IPAddress.IsLoopback(a.Address) || a.Address.ToString().StartsWith("169.254.")) continue;
                    all.Add(a.Address.ToString()); if (gw) withGw.Add(a.Address.ToString());
                }
            }
        }
        catch (Exception) { }
        return (withGw.Count > 0 ? withGw : all).Distinct().ToList();
    }

    /// <summary>The one-time permission: one admin prompt (UAC). False = refused or failed.</summary>
    public static bool Setup(int port)
    {
        string rule = $"LMU Hub (port {port})";                                         // the old name on purpose: a rule made before the rename is replaced, not doubled
        string cmd = $"/c netsh http add urlacl url={Prefix(port)} sddl=D:(A;;GX;;;WD) & netsh advfirewall firewall delete rule name=\"{rule}\" & " +
                     $"netsh advfirewall firewall add rule name=\"{rule}\" dir=in action=allow protocol=TCP localport={port} profile=private";
        try
        {
            using var p = Process.Start(new ProcessStartInfo("cmd.exe", cmd) { Verb = "runas", UseShellExecute = true, WindowStyle = ProcessWindowStyle.Hidden });
            p?.WaitForExit(30_000);
            return true;
        }
        catch (Win32Exception) { return false; }                                       // "No" in the admin prompt
    }
}
