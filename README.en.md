# LMU Telemetry Analyzer

🌐 **English** · [Français](README.md)

A lightweight, local web app for analyzing **Le Mans Ultimate** telemetry. It reads the
**DuckDB telemetry files** recorded by the game (`UserData\Telemetry\*.duckdb`), automatically loads the
latest recording and shows you **where you lose time on track** – plus tire/brake analysis, a
pit-stop/energy calculator and a setup comparison.

> Pure local app – runs offline, no cloud, no account. A small Node "bridge" reads the DuckDB files via
> the bundled DuckDB CLI and serves the HTML interface at `http://localhost:8777`.

## Features

- 🎯 **Where am I losing time?** – Time delta across the lap, automatically detected loss zones with concrete tips (braking point, minimum speed, throttle application).
- 📈 **Comparison** – Speed / throttle / brake / steering / gear of two laps overlaid.
- 🗺️ **Interactive track map** (large, at the top; also in the comparison and tire tabs) – hovering over the track with the mouse shows **speed, delta, throttle and brake** at that point; switchable between delta (gain/loss) or speed coloring; in the tire tab colored by **brake temperature** (avg of 4 brakes); synchronized with the charts. **All track maps are zoomable** (scroll wheel to zoom, drag to pan, double-click to reset).
- 📂 **Upload reference lap** – load your own **MoTeC `.ld` file** as a reference lap and compare your laps against it.
- ⏱️ **Sector times** – S1/S2/S3 per lap, best sectors highlighted, theoretical best time.
- 🌦️ **Weather & track** – conditions, air/track temperature, wind, wetness.
- 🧭 **Gain/loss track map** – always-visible mini map (sidebar), green = time gained, red = lost.
- 📋 **Last session** – table of all laps: time, Δ to best time, top speed, virtual energy/fuel/tire consumption per lap.
- 🔄 **Version check** – automatically notifies you when a newer release is available on GitHub.
- 🛞 **Tires & brakes** – temperature (inner/middle/outer per wheel), pressure, remaining tread/wear, brake temperatures + hints on pressure/camber/balance.
- 🔧 **Setup & Pace** – compares two of your sessions: what was changed in the setup and how the best time changed, plus setup hints derived from telemetry. Includes a section linking to external **setup providers**.
- ⛽ **Pit-stop calculator** – from race length, tire sets, drivers and the measured pace/consumption: stint lengths, target virtual energy per lap, fastest overall-time strategy, driver allocation (accounts for both energy **and** tire wear). Plus a **lift & coast track map**: shows the braking zones with the greatest fuel-saving potential (① = best zone), with dynamic lift distance based on entry speed and selectable strategies.
- ⏺ **Live** – automatically loads the new recording after each stint; while a recording is running (file locked) the last completed session is shown.
- 🌐 **Language** – interface switchable with one click between **French, English and German** (top right).
- 🪟 **Clean interface** – **collapsible sidebar**, **delta graph** also in the comparison tab, and a home button in the header. Delta comparisons consistently ignore out/in laps as a reference.

## Requirements

- Windows with **Le Mans Ultimate** (PC, v1.2+ with native telemetry recording).
- **Node.js** – to run the bridge. The launcher **installs/downloads it automatically** if not present (via winget or portable, no admin rights required).
- Telemetry recording enabled in LMU (see below).

## Enabling telemetry recording in LMU

In `…\Le Mans Ultimate\UserData\player\Settings.JSON`:

```json
"Automatically Record Telemetry": true
```

(Close LMU first.) Alternatively, in-game under *Options → Controls* assign the
**"Telemetry Recording"** function to a key and start it manually per stint. Afterwards, `.duckdb`
files appear in `UserData\Telemetry`.

## Getting started

**Easiest – without a console window:** double-click **`LMU-Telemetry-Analyzer-Vx.x.x.exe`**. The app
starts completely in the background (**no black command-line window**) and opens the browser
automatically. Quit via the **⏻ button** at the top right of the app. (The DuckDB CLI is downloaded on
first start if not present alongside it. The app writes messages to `lmu-telemetrie.log` next to the
EXE.)

**From source (with Node.js):** double-click **`Start LMU Telemetrie.cmd`**. On first start the script
automatically obtains **Node.js** (if needed) and the **DuckDB CLI**, starts the bridge and opens
`http://localhost:8777` in the browser.

The telemetry folder is found automatically via the Steam libraries. For a different path:
```
node lmu-bridge.js --dir="D:\path\to\Le Mans Ultimate\UserData\Telemetry"
```

## How it works

LMU writes telemetry as a **DuckDB database** – one table per channel/event (`value` or `value1..4` per
wheel), plus meta tables (`metadata`, `channelsList`, `eventsList`); the complete vehicle setup is
stored as JSON in `metadata`. Since a browser cannot read DuckDB directly, the bridge (`lmu-bridge.js`)
reads the files via `duckdb.exe` and provides them as JSON. The entire analysis (lap detection, delta,
tires, strategy) runs in the browser (`lmu-telemetry-analyzer.html`, vanilla JS, custom canvas charts,
no external libraries).

## Privacy

**No data is uploaded.** Best-time references and the session history are stored only locally in the
browser (`localStorage`). The telemetry files stay on your machine.

## License

MIT – see [LICENSE](LICENSE). Not an official Studio-397/Motorsport Games product; "Le Mans Ultimate" is
the property of its respective rights holders.
