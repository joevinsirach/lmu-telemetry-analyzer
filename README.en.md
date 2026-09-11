# LMU Telemetry Analyzer

🌐 **English** · [Français](README.md)

A lightweight, local web app for analyzing **Le Mans Ultimate** telemetry. It reads the
**DuckDB telemetry files** recorded by the game (`UserData\Telemetry\*.duckdb`) and opens on a
**home menu with three modes: Session · Track · Car**. From there you analyse recordings –
**where you lose time on track** – plus tire/brake analysis, vehicle stats (shift points, power,
torque), a pit-stop/energy calculator and a setup comparison.

> Pure local app – runs offline, no cloud, no account. A small Node "bridge" reads the DuckDB files via
> the bundled DuckDB CLI and serves the HTML interface at `http://localhost:8777`.

## Features

- 🏠 **Three modes** – on launch three cards: **Session** (one recording, existing analysis including Live), **Track** (layout + class, compare every lap across sessions) and **Car** (brand + class, straight-line power/shift points only). Analysis starts only after the final choice; the latest recording is not loaded automatically.
- 🏁 **Track** – grouped by **track + layout** (e.g. Silverstone National ≠ Grand Prix). Then the classes present (GT3 / P2 / P3 / HY from telemetry `CarClass`). Reference and comparison can be any two laps in the pack, even from different files.
- 🚗 **Car** – groups such as **BMW · GT3** (all years/teams together): optimal upshift points (% of max RPM) and power/torque curves from **straight-line full throttle** only (|lat G| low, steering ≈ 0).
- 🎯 **Where am I losing time?** – Time delta across the lap, automatically detected loss zones with concrete tips (braking point, minimum speed, throttle application).
- 📈 **Comparison** – Speed / throttle / brake / steering / gear of two laps overlaid.
- 🗺️ **Interactive track map** (large, at the top; also in the comparison and tire tabs) – hovering over the track with the mouse shows **speed, delta, throttle and brake** at that point; switchable between delta (gain/loss) or speed coloring; in the tire tab colored by **brake temperature** (avg of 4 brakes); synchronized with the charts. **All track maps are zoomable** (scroll wheel to zoom, drag to pan, double-click to reset).
- 📂 **Upload reference lap** – load your own **MoTeC `.ld` file** as a reference lap and compare your laps against it.
- ⏱️ **Sector times** – S1/S2/S3 per lap, best sectors highlighted, theoretical best time.
- 🌦️ **Weather & track** – conditions, air/track temperature, wind, wetness.
- 🧭 **Gain/loss track map** – always-visible mini map (sidebar), green = time gained, red = lost.
- 📋 **Last session** – in Session mode, laps of the loaded recording; in Track mode, **every lap** of that layout + class.
- 🔄 **Version check** – automatically notifies you when a newer release is available on GitHub.
- 🛞 **Tires & brakes** – temperature (inner/middle/outer per wheel), pressure, remaining tread/wear, brake temperatures + hints on pressure/camber/balance.
- 🔧 **Setup & Pace** – compares two of your sessions: what was changed in the setup and how the best time changed, plus setup hints derived from telemetry. Includes a section linking to external **setup providers**.
- ⛽ **Pit-stop calculator** – from race length, tire sets, drivers and the measured pace/consumption: stint lengths, target virtual energy per lap, fastest overall-time strategy, driver allocation (accounts for both energy **and** tire wear). Plus a **lift & coast track map**: shows the braking zones with the greatest fuel-saving potential (① = best zone), with dynamic lift distance based on entry speed and selectable strategies.
- ⏺ **Live** – **Session mode only** (otherwise off): automatically load the new recording after each stint; while a recording is running (file locked) the last completed session is shown.
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

**From source (with Node.js):**
- **Windows:** double-click **`Lancer LMU Telemetrie Windows.cmd`**.
- **Mac:** double-click **`Lancer LMU Telemetrie Mac.command`**.

On first start the script automatically obtains **Node.js** (if needed) and the **DuckDB CLI**, starts
the bridge and opens `http://localhost:8777` in the browser.

The telemetry folder is found automatically via the Steam libraries. For a different path:
```
node lmu-bridge.js --dir="D:\path\to\Le Mans Ultimate\UserData\Telemetry"
```

## How it works

bridge (`lmu-bridge.js`) reads the files via `duckdb.exe` and provides them as JSON. Car, track,
layout, class (`CarClass`) and light lap times are indexed in the background (`/api/session-meta`,
cache `session-index.json`) so the home menu can fill the three modes without fully loading every
file. The entire analysis (lap detection, delta, tires, shift points, strategy) runs in the browser
(`lmu-telemetry-analyzer.html`, vanilla JS, custom canvas charts, no external libraries).

## Privacy

**No data is uploaded.** Best-time references and the session history are stored only locally in the
browser (`localStorage`). The telemetry files stay on your machine.

## License

MIT – see [LICENSE](LICENSE). Not an official Studio-397/Motorsport Games product; "Le Mans Ultimate" is
the property of its respective rights holders.
