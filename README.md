<p align="center"><img src="docs/images/logo.png" width="128" alt="My LMU Hub logo"></p>

<h1 align="center">My LMU Hub</h1>

<p align="center"><b>A free pitwall dashboard and personal stats hub for Le Mans Ultimate.</b><br>
One Windows app, no SimHub, no install. Made for endurance racers, and for watching your team-mate drive.</p>

<p align="center"><a href="https://github.com/SKMots/MyLMUHub/releases/latest"><b>Download the latest release</b></a></p>

---

![Race Control](docs/images/race-control.png)

## What it does

### Race Control: the live dashboard
A full-screen dashboard for a second monitor, tablet or another PC. It's built from widgets that you **move, resize and style** yourself (press **E**).

- **Standings** per class: gaps, intervals, sectors, best / last / average laps, pit stops, virtual energy and car logos.
- **Cars ahead and behind**, a **relative**, and the **track map**. The map learns each track by itself and marks yellow flags on it.
- **Top bar:** position, laps, time left, lap times, a live delta and sectors.
- **Your car:** fuel and virtual energy (laps left, how much to refuel), tyres and brakes, damage, and electronics (TC / ABS / brake bias / engine map).
- **Best lap ever**, a **weather forecast**, and a **race prediction**: where you'll finish, based on everyone's real race pace.
- **Twitch chat** and viewer count, for streamers.
- **Spectator mode:** follow your team-mate's car while they drive. The whole dashboard switches to them.
- **Several named views** (e.g. "Race", "Qualifying"), switched by keyboard shortcuts or wheel / button-box buttons.
- **Network access:** open the same dashboard on a tablet or a second PC at home.

### The Hub: your own data
| | |
|---|---|
| ![Home](docs/images/home.png) | ![Race Pace](docs/images/race-pace.png) |
| **Home:** what you drove in the last 7 days and how much faster you got. | **Race Pace:** your level against the alien times of the community lap-time sheet, with progress over time, per track, class and car. |
| ![Untapped potential](docs/images/potential.png) | ![Strategy](docs/images/strategy.png) |
| **Untapped potential:** the tracks behind your level, the time between your best and your optimal lap, and **Segments** (~150 m pieces of the lap) showing exactly where you lose time. | **Strategy planner:** plan stints from virtual energy, tyres and driver swaps. It follows the live race and adjusts. Plus a quick planner for short races. |

- Reads the game's own result files, so **all your past sessions count** from the first start.
- **Guest mode:** a friend drives on your rig and sees their own data, without mixing it into yours. **My sessions:** hide or remove sessions someone else drove.
- Four themes: Lime, Teal, Daylight and Navy.
- **Updates itself.** When a new version is out, the hub shows an update button.

### Light on your PC
It runs only while you have it open and doesn't animate anything continuously. Each screen updates only what changed.
The game's data is read straight from LMU's shared memory, so no SimHub or plugins are needed.

## Getting started
1. Download **`MyLMUHub.exe`** from the [latest release](https://github.com/SKMots/MyLMUHub/releases/latest). Put it in a folder of your own, such as Documents\MyLMUHub (not Program Files: it updates itself there).
2. Start it. The hub opens. Click your name in the top right and enter your driver name(s) **exactly as in the game**.
3. Start Le Mans Ultimate and join a session. Click **Race Control** and drag the window to your second monitor; **F11** makes it full screen.

Needs Windows 10 or 11 with the Microsoft Edge WebView2 Runtime (already on Windows 11 and most Windows 10 PCs).
Settings live in `%AppData%\MyLMUHub`.

**Shortcuts:**
- **E** edits the layout.
- **F11** toggles full screen.
- **F12** opens the developer tools.

## Build it yourself
Requirements: Windows and the [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0).

```powershell
# run from source (needs the game running)
dotnet run --project src/Pitwall.App
# or build the single exe, like the releases
dotnet publish src/Pitwall.App/Pitwall.App.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeAllContentForSelfExtract=true -p:DebugType=none -o dist
```

A self-built exe doesn't update itself. **No .NET at all?** Open `src/Pitwall.App/wwwroot/index.html` in Chrome or Edge to see the dashboard on demo data; keys **1-5** switch the scenario.
### How it's put together
- **`Pitwall.Core`** (C#, no UI): reads the game's shared memory and turns it into numbers: standings, gaps, stints, pace and flags.
- **`Pitwall.App`** (WPF + WebView2): the windows, a small local web server with a WebSocket, auto-update and settings.
- **`wwwroot`** (plain JavaScript, no build step, no npm): every page and widget. All text formatting lives in `js/format.js`.

"Pitwall" is the internal code name from the first version.

## Ideas, bugs and contributions
Ideas are very welcome: that's why this project is open source. Open an [issue](https://github.com/SKMots/MyLMUHub/issues) for a bug or a feature idea.
Pull requests are welcome too. Please keep them focused and keep the app light on CPU.

## Credits and notes
- Car-make logos are trademarks of their respective owners and are only used to identify the cars. The full-colour set comes from the open
  [car-logos-dataset](https://github.com/filippofilip95/car-logos-dataset).
- Reference lap times come from the community LMU laptimes sheet by Ohne Speed.
- Weather icons are based on [TinyPedal](https://github.com/s-victor/TinyPedal) (CC BY-SA 4.0).
- The driver names in the demo data are made up.
- Not affiliated with or endorsed by Studio 397 or Le Mans Ultimate. The game's SDK headers are not included.

## License
[MIT](LICENSE)
