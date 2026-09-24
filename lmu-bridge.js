/* ===========================================================================
   LMU Telemetrie-Bridge
   Liest die von Le Mans Ultimate aufgezeichneten DuckDB-Telemetriedateien
   (UserData\Telemetry\*.duckdb) und optional den lokalen Ordner telemetry\
   neben der App. Beide Quellen erscheinen gleichzeitig in der Session-Liste.
   Start:  node lmu-bridge.js  [--dir="<Pfad zu UserData\Telemetry>"] [--port=8777]
   =========================================================================== */
"use strict";
const http = require("http");
const https = require("https");
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, execFile, spawn } = require("child_process");

const ARG = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
}));
const PORT = parseInt(ARG.port || process.env.LMU_PORT || "8777", 10);
// Bei .exe (pkg) liegen Daten neben der EXE; im Node-Lauf neben dem Skript.
const BASE = process.pkg ? path.dirname(process.execPath) : __dirname;
// macOS: Documents/Desktop/Downloads sind TCC-geschützt. Chrome-Profil und DuckDB
// dürfen NICHT im Projektordner liegen, sonst blockiert macOS Node (EPERM).
const DATA_DIR = process.platform === "darwin"
  ? path.join(os.homedir(), "Library", "Application Support", "LMU Telemetry Analyzer")
  : BASE;
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
const DUCKDB = path.join(DATA_DIR, "duckdbcli", process.platform === "win32" ? "duckdb.exe" : "duckdb");
const HTML = path.join(__dirname, "lmu-telemetry-analyzer.html"); // im pkg-Snapshot eingebettet
const LOGO = path.join(__dirname, "LOGO_LM2.svg");
const CHROME_PROFILE = path.join(DATA_DIR, "chrome-profile");
const REPO = "mzluzifer/lmu-telemetry-analyzer";
const APP_VERSION = "1.10.0";
let HTML_BUF = null;
let LOGO_BUF = null;
function readBundled(src, destName) {
  try {
    return fs.readFileSync(src);
  } catch (e) {
    if (e.code !== "EPERM" && e.code !== "EACCES") throw e;
    const dest = path.join(DATA_DIR, destName);
    execFileSync("/bin/cp", ["-f", src, dest]);
    return fs.readFileSync(dest);
  }
}
function loadHtml() {
  if (process.pkg && HTML_BUF) return HTML_BUF;
  HTML_BUF = readBundled(HTML, "lmu-telemetry-analyzer.html");
  return HTML_BUF;
}
function loadLogo() {
  if (process.pkg && LOGO_BUF) return LOGO_BUF;
  try {
    LOGO_BUF = readBundled(LOGO, "LOGO_LM2.svg");
    return LOGO_BUF;
  } catch (_) {
    return null;
  }
}

// --- Kein Konsolenfenster -------------------------------------------------
// Die .exe wird als GUI-Subsystem gebaut (Post-Build-Patch in build-exe.ps1),
// daher erscheint beim Start KEIN Kommandozeilenfenster. In diesem Modus gibt es
// kein gültiges stdout/stderr – Schreibzugriffe darauf würden den Prozess
// abstürzen lassen. Deshalb leiten wir alle Konsolenausgaben in eine Logdatei
// neben der EXE um und fassen process.stdout/stderr nicht an.
// (--hidden / --no-hide werden weiterhin als No-Op akzeptiert.)
if (process.pkg) {
  const LOG = path.join(BASE, "lmu-telemetrie.log");
  const util = require("util");
  try { if (fs.existsSync(LOG) && fs.statSync(LOG).size > 1024 * 1024) fs.writeFileSync(LOG, ""); } catch (_) {}
  const writeLog = (lvl, args) => {
    try {
      fs.appendFileSync(LOG, "[" + new Date().toISOString() + "] " + lvl + "  " +
        args.map(a => typeof a === "string" ? a : util.inspect(a)).join(" ") + "\r\n");
    } catch (_) {}
  };
  console.log = (...a) => writeLog("INFO ", a);
  console.info = (...a) => writeLog("INFO ", a);
  console.warn = (...a) => writeLog("WARN ", a);
  console.error = (...a) => writeLog("ERROR", a);
  console.debug = (...a) => writeLog("DEBUG", a);
  process.on("uncaughtException", e => writeLog("FATAL", [e && e.stack || e]));
  process.on("unhandledRejection", e => writeLog("FATAL", [e && e.stack || e]));
} else {
  process.on("uncaughtException", e => { console.error("FATAL", e && e.stack || e); process.exit(1); });
  process.on("unhandledRejection", e => { console.error("FATAL", e && e.stack || e); });
  if (process.platform === "win32") {
    try { execFileSync("cmd.exe", ["/d", "/c", "chcp 65001 >nul"], { stdio: "ignore", windowsHide: true }); } catch (_) {}
  }
}

// DuckDB-CLI bei Bedarf herunterladen (Windows-.exe und macOS-Doppelklick)
function ensureDuckDB() {
  if (fs.existsSync(DUCKDB)) return;
  console.log("Téléchargement de la CLI DuckDB (une seule fois)...");
  const dir = path.join(BASE, "duckdbcli");
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  try {
    if (process.platform === "win32") {
      execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
        "$ErrorActionPreference='Stop'; $z=Join-Path $env:TEMP 'lmu_dk.zip'; Invoke-WebRequest 'https://github.com/duckdb/duckdb/releases/download/v1.4.0/duckdb_cli-windows-amd64.zip' -OutFile $z; Expand-Archive $z -DestinationPath '" + dir + "' -Force; Remove-Item $z -Force"],
        { stdio: "ignore", windowsHide: true });
    } else if (process.platform === "darwin") {
      const zip = path.join(os.tmpdir(), "lmu_dk.zip");
      execFileSync("curl", ["-fsSL", "-o", zip, "https://github.com/duckdb/duckdb/releases/download/v1.4.0/duckdb_cli-osx-universal.zip"], { stdio: "ignore" });
      execFileSync("unzip", ["-o", zip, "-d", dir], { stdio: "ignore" });
      try { fs.unlinkSync(zip); } catch (_) {}
      try { fs.chmodSync(DUCKDB, 0o755); } catch (_) {}
    } else {
      console.error("CLI DuckDB manquante : " + DUCKDB);
      return;
    }
  } catch (e) { console.error("Échec du téléchargement de DuckDB :", e.message); }
}
// Standard-Browser als Tab öffnen (Fallback, wenn kein Edge/Chrome gefunden wird
// oder der App-Start fehlschlägt). Beendet die Bridge NICHT mit, da hier kein
// überwachbarer Prozess vorliegt.
function openBrowserTab() {
  const url = "http://localhost:" + PORT;
  try {
    if (process.platform === "darwin") {
      const args = fs.existsSync("/Applications/Google Chrome.app")
        ? ["-a", "Google Chrome", url]
        : [url];
      const child = spawn("open", args, { detached: true, stdio: "ignore" });
      child.unref();
    } else if (process.platform === "win32") {
      const child = spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true });
      child.unref();
    } else {
      const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
      child.unref();
    }
  } catch (e) {
    console.error("Impossible d'ouvrir le navigateur :", e.message);
  }
}

// Chrome (macOS) bzw. Edge/Chrome (Windows) – für den App-Modus (eigenes Fenster).
function findBrowser() {
  const home = process.env.HOME || "";
  const candidates = process.platform === "darwin" ? [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    path.join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
  ] : process.platform === "linux" ? [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ] : [
    path.join(process.env["ProgramFiles"] || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
    process.env["LOCALAPPDATA"] && path.join(process.env["LOCALAPPDATA"], "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env["ProgramFiles"] || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
  ];
  for (const c of candidates.filter(Boolean)) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  return null;
}

// App in einem eigenständigen Fenster öffnen (Edge/Chrome --app-Modus): kein Tab,
// keine Adressleiste, eigenes Taskleisten-Icon. Das Fenster läuft als überwachter
// Kindprozess – wird es geschlossen, beendet sich auch die Bridge.
function openApp() {
  const url = "http://localhost:" + PORT;
  const browser = findBrowser();
  if (!browser) { console.log("Edge/Chrome introuvable — ouverture du navigateur par défaut."); return openBrowserTab(); }
  // Eigenes Profilverzeichnis erzwingt einen unabhängigen Browser-Prozess, dessen
  // Lebensdauer dem Fenster entspricht (sonst übergibt Edge/Chrome an eine bereits
  // laufende Instanz und der Kindprozess endet sofort).
  const profile = CHROME_PROFILE;
  try { fs.mkdirSync(profile, { recursive: true }); } catch (_) {}
  try {
    const started = Date.now();
    let keepRunning = false;
    const child = spawn(browser, [
      "--app=" + url,
      "--user-data-dir=" + profile,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1400,900",
    ], { stdio: "ignore" });   // KEIN windowsHide: das würde Edges/Chromes GUI-Fenster verstecken (SW_HIDE)
    child.on("exit", () => {
      // Même profil déjà ouvert, ou verrou Chrome : le process enfant meurt tout de suite
      // sans fenêtre. On garde le pont et on ouvre un onglet visible.
      if (!keepRunning && Date.now() - started < 3000) {
        keepRunning = true;
        console.log("Fenêtre --app indisponible — ouverture dans le navigateur.");
        openBrowserTab();
        return;
      }
      if (keepRunning) return;
      console.log("Fenêtre de l'app fermée — arrêt du pont.");
      process.exit(0);
    });
    child.on("error", e => { console.error("Impossible de démarrer la fenêtre de l'app :", e.message); openBrowserTab(); });
  } catch (e) { console.error("Échec du démarrage de l'app :", e.message); openBrowserTab(); }
}
// Neueste Release-Version ermitteln: erst gh (auch bei privatem Repo), sonst öffentliche API
function getLatestVersion(cb) {
  for (const g of ["gh", "C:\\Program Files\\GitHub CLI\\gh.exe"]) {
    try {
      const out = execFileSync(g, ["api", "repos/" + REPO + "/releases/latest", "--jq", ".tag_name + \"|\" + .html_url"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
      const p = out.trim().split("|"); if (p[0]) return cb(p[0], p[1] || "");
    } catch (e) {}
  }
  https.get({ host: "api.github.com", path: "/repos/" + REPO + "/releases/latest", headers: { "User-Agent": "lmu-telemetry" } },
    r => { let d = ""; r.on("data", c => d += c); r.on("end", () => { try { const j = JSON.parse(d); cb(j.tag_name || null, j.html_url || ""); } catch (e) { cb(null, ""); } }); })
    .on("error", () => cb(null, ""));
}

/* ---- Telemetrie-Ordner finden (LMU-Spiel + lokaler Ordner telemetry/) ---- */
function samePath(a, b) {
  if (!a || !b) return false;
  try { return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase(); } catch { return false; }
}
function regValue(key, name) {
  try {
    const out = execFileSync("reg", ["query", key, "/v", name], { encoding: "utf8", windowsHide: true });
    const m = out.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)/);
    if (!m) return "";
    return m[1].trim().replace(/%([^%]+)%/g, (_, k) => process.env[k] || process.env[k.toUpperCase()] || "");
  } catch (_) { return ""; }
}
function findSteamRoots() {
  const roots = [];
  const add = (p) => { if (p && !roots.some(r => samePath(r, p))) roots.push(p); };
  if (process.platform === "win32") {
    add(regValue("HKCU\\Software\\Valve\\Steam", "SteamPath"));
    add(regValue("HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"));
    add(regValue("HKLM\\SOFTWARE\\Valve\\Steam", "InstallPath"));
    add(path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Steam"));
    add(path.join(process.env.ProgramFiles || "C:\\Program Files", "Steam"));
  } else if (process.platform === "darwin") {
    add(path.join(os.homedir(), "Library", "Application Support", "Steam"));
  } else {
    add(path.join(os.homedir(), ".steam", "steam"));
    add(path.join(os.homedir(), ".local", "share", "Steam"));
  }
  return roots;
}
function findLmuTelemetryDir() {
  if (ARG.dir) return ARG.dir;
  if (process.env.LMU_TELEMETRY_DIR) return process.env.LMU_TELEMETRY_DIR;
  const libs = [];
  for (const root of findSteamRoots()) {
    try {
      const t = fs.readFileSync(path.join(root, "steamapps", "libraryfolders.vdf"), "utf8");
      for (const m of t.matchAll(/"path"\s*"([^"]+)"/g)) libs.push(m[1].replace(/\\\\/g, "\\"));
    } catch (_) {}
    libs.push(root);
  }
  for (const lib of libs) {
    const p = path.join(lib, "steamapps", "common", "Le Mans Ultimate", "UserData", "Telemetry");
    try { if (fs.existsSync(p)) return p; } catch (_) {}
  }
  return null;
}
function findManualTelemetryDir() {
  const srcBase = process.env.LMU_APP_SRC || BASE;
  const localTel = path.join(srcBase, "telemetry");
  try { fs.mkdirSync(localTel, { recursive: true }); return localTel; } catch (_) { return null; }
}
function findDownloadsDir() {
  if (process.platform === "win32") {
    const guid = "{374DE290-123F-4565-9164-39C4925E467B}";
    for (const key of [
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders",
    ]) {
      const p = regValue(key, guid);
      try { if (p && fs.existsSync(p) && fs.statSync(p).isDirectory()) return p; } catch (_) {}
    }
  }
  const home = os.homedir();
  for (const name of ["Downloads", "Téléchargements", "Telechargements"]) {
    const p = path.join(home, name);
    try { if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p; } catch (_) {}
  }
  return null;
}
function findTelemetryDirs() {
  let lmuDir = findLmuTelemetryDir();
  const manualDir = findManualTelemetryDir();
  const downloadsDir = findDownloadsDir();
  if (lmuDir && manualDir && samePath(lmuDir, manualDir)) lmuDir = null;
  return { lmuDir, manualDir, downloadsDir };
}
const TEL = findTelemetryDirs();
const TEL_DIR = TEL.lmuDir || TEL.manualDir || TEL.downloadsDir;
const EXTRA_DIRS_PATH = path.join(DATA_DIR, "telemetry-dirs.json");
let EXTRA_DIRS = [];
function loadExtraDirs() {
  try {
    const j = JSON.parse(fs.readFileSync(EXTRA_DIRS_PATH, "utf8"));
    EXTRA_DIRS = (Array.isArray(j.extra) ? j.extra : []).filter(p => typeof p === "string" && p);
  } catch (_) { EXTRA_DIRS = []; }
}
function saveExtraDirs() {
  try { fs.writeFileSync(EXTRA_DIRS_PATH, JSON.stringify({ extra: EXTRA_DIRS }, null, 2)); } catch (_) {}
}
loadExtraDirs();
function telDirs() {
  const dirs = [];
  const push = (dir, src) => {
    if (!dir) return;
    if (dirs.some(d => samePath(d.dir, dir))) return;
    dirs.push({ dir: path.resolve(dir), src });
  };
  push(TEL.lmuDir, "lmu");
  push(TEL.manualDir, "manual");
  push(TEL.downloadsDir, "downloads");
  EXTRA_DIRS.forEach(p => push(p, "extra"));
  return dirs;
}
function publicDirs() {
  const used = [];
  const take = (kind, dir) => {
    if (!dir) return null;
    if (used.some(p => samePath(p, dir))) return null;
    const abs = path.resolve(dir);
    used.push(abs);
    return { kind, path: abs };
  };
  const defaults = [take("lmu", TEL.lmuDir), take("manual", TEL.manualDir), take("downloads", TEL.downloadsDir)].filter(Boolean);
  const extra = [];
  EXTRA_DIRS.forEach(p => {
    if (!p || used.some(u => samePath(u, p)) || extra.some(u => samePath(u, p))) return;
    extra.push(path.resolve(p));
  });
  return { defaults, extra };
}
function addExtraDir(raw) {
  let dir;
  try { dir = path.resolve(String(raw || "")); } catch (_) { return { ok: false, status: 400, error: "dossier invalide" }; }
  let st;
  try { st = fs.statSync(dir); } catch (_) { return { ok: false, status: 400, error: "dossier introuvable" }; }
  if (!st.isDirectory()) return { ok: false, status: 400, error: "dossier introuvable" };
  if (telDirs().some(d => samePath(d.dir, dir))) return { ok: true, status: 200, already: true, ...publicDirs() };
  EXTRA_DIRS.push(dir);
  saveExtraDirs();
  return { ok: true, status: 200, ...publicDirs() };
}
function removeExtraDir(raw) {
  const before = EXTRA_DIRS.length;
  EXTRA_DIRS = EXTRA_DIRS.filter(p => !samePath(p, raw));
  if (EXTRA_DIRS.length !== before) saveExtraDirs();
  return { ok: true, status: 200, ...publicDirs() };
}
function pickFolder() {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") return resolve("");
    const ps = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$f = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$f.Description = 'Dossier de telemetrie'",
      "$f.ShowNewFolderButton = $false",
      "if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $f.SelectedPath }"
    ].join("; ");
    execFile("powershell.exe", ["-NoProfile", "-STA", "-Command", ps],
      { windowsHide: false, timeout: 120000, encoding: "utf8" },
      (err, stdout) => {
        if (err && err.killed) return reject(err);
        const line = String(stdout || "").trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean).pop() || "";
        resolve(line);
      });
  });
}
function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    let n = 0, d = "";
    req.on("data", c => {
      n += c.length;
      if (n > limit) { req.destroy(); reject(Object.assign(new Error("corps trop grand"), { status: 413 })); return; }
      d += c;
    });
    req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(Object.assign(e, { status: 400 })); } });
    req.on("error", reject);
  });
}

/* ---- Gewünschte Kanäle (Name -> Ziel-Frequenz Hz fürs Downsampling) ---- */
const WANT_CH = {
  "Lap Dist": 10, "Ground Speed": 50, "Throttle Pos": 50, "Throttle Pos Unfiltered": 50, "Brake Pos": 50,
  "Steering Pos": 50, "Engine RPM": 25, "GPS Latitude": 10, "GPS Longitude": 10,
  "G Force Lat": 10, "G Force Long": 10, "Fuel Level": 5, "Virtual Energy": 5,
  "SoC": 5, "Wheel Speed": 25, "Steering Shaft Torque": 25, "Path Lateral": 10,
  "Ambient Temperature": 1, "Track Temperature": 1, "Wind Speed": 1, "Wind Heading": 1,
};
const WANT_EV = ["Gear", "Lap", "Lap Time", "Last Sector1", "Last Sector2",
  "Current Sector", "In Pits", "TC", "TCCut", "ABS", "TCLevel", "ABSLevel", "Best LapTime",
  "Best Sector1", "Best Sector2", "Minimum Path Wetness", "CloudDarkness", "Yellow Flag State"];
// Mehrdimensionale Kanäle pro Rad (value1..4 = FL,FR,RL,RR) -> Ziel-Frequenz
const WANT_WHEEL = {
  "Tyres Wear": 5, "TyresPressure": 5, "TyresTempCentre": 10,
  "TyresTempLeft": 10, "TyresTempRight": 10, "TyresRubberTemp": 5,
  "Brakes Temp": 5,
};

function q(id) { return '"' + String(id).replace(/"/g, '""') + '"'; }

function duckExec(file, sql) {
  return new Promise((resolve, reject) => {
    execFile(DUCKDB, [file, "-readonly", "-json", "-c", sql],
      { maxBuffer: 512 * 1024 * 1024, encoding: "utf8", windowsHide: true, timeout: 180000 },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr;
          return reject(err);
        }
        try {
          const rows = JSON.parse(stdout || "[]");
          resolve(rows.length ? JSON.parse(rows[0].doc) : null);
        } catch (e) { reject(e); }
      });
  });
}
// Une requête DuckDB à la fois — le serveur HTTP reste réactif (sessions/config/quit).
let duckChain = Promise.resolve();
function duck(file, sql) {
  const run = () => duckExec(file, sql);
  const p = duckChain.then(run, run);
  duckChain = p.then(() => {}, () => {});
  return p;
}

async function loadCatalog(file) {
  const sql = `SELECT (json_object(
    'meta',(SELECT json_group_object(key,value) FROM metadata WHERE key<>'CarSetup'),
    'channels',(SELECT json_group_array(json_object('name',channelName,'freq',frequency,'unit',unit)) FROM channelsList),
    'events',(SELECT json_group_array(json_object('name',eventName,'unit',unit)) FROM eventsList),
    'tables',(SELECT json_group_array(table_name) FROM information_schema.tables),
    'cols',(SELECT json_group_object(table_name, cols) FROM (SELECT table_name, list(column_name) AS cols FROM information_schema.columns GROUP BY table_name))
  ))::VARCHAR AS doc`;
  return duck(file, sql);
}

async function loadSession(file) {
  const cat = await loadCatalog(file);
  if (!cat) throw new Error("Katalog leer");
  const tables = new Set(cat.tables || []);
  const cols = cat.cols || {};
  const chMeta = {};
  (cat.channels || []).forEach(c => { chMeta[c.name] = c; });
  const valueCol = (name) => {
    const c = cols[name] || ["value"];
    return c.includes("value") ? "value" : c[0];   // mehrdim. Kanäle: erste Spalte
  };

  // Kanal-Stücke
  const outChannels = [];
  const chPieces = [];
  for (const [name, target] of Object.entries(WANT_CH)) {
    if (!tables.has(name)) continue;
    const freq = (chMeta[name] && chMeta[name].freq) || target;
    const stride = Math.max(1, Math.round(freq / target));
    const effFreq = freq / stride;
    chPieces.push(`${sqlStr(name)},(SELECT to_json(list(${q(valueCol(name))} ORDER BY rowid)) FROM ${q(name)} WHERE rowid % ${stride} = 0)`);
    outChannels.push({ name, unit: (chMeta[name] && chMeta[name].unit) || "", freq: effFreq, nativeFreq: freq });
  }
  // Event-Stücke (nur wenn ts+value vorhanden)
  const evPieces = [];
  const evNames = [];
  for (const name of WANT_EV) {
    if (!tables.has(name)) continue;
    const c = cols[name] || [];
    if (!c.includes("ts") || !c.includes("value")) continue;
    evPieces.push(`${sqlStr(name)},(SELECT to_json(list(json_object('ts',ts,'v',value) ORDER BY ts)) FROM ${q(name)})`);
    evNames.push(name);
  }
  // Rad-Kanäle (value1..4 = FL,FR,RL,RR)
  const wheelOut = [];
  const whPieces = [];
  for (const [name, target] of Object.entries(WANT_WHEEL)) {
    if (!tables.has(name)) continue;
    // Numerisch sortieren: information_schema garantiert keine Spaltenreihenfolge,
    // value1..4 müssen aber exakt FL,FR,RL,RR entsprechen.
    const valCols = (cols[name] || []).filter(c => /^value\d+$/.test(c))
      .sort((a, b) => parseInt(a.slice(5), 10) - parseInt(b.slice(5), 10));
    if (!valCols.length) continue;
    const freq = (chMeta[name] && chMeta[name].freq) || target;
    const stride = Math.max(1, Math.round(freq / target));
    const parts = valCols.map((vc, i) => `'${i + 1}',(SELECT to_json(list(${q(vc)} ORDER BY rowid)) FROM ${q(name)} WHERE rowid % ${stride} = 0)`);
    whPieces.push(`${sqlStr(name)},json_object(${parts.join(",")})`);
    wheelOut.push({ name, unit: (chMeta[name] && chMeta[name].unit) || "", freq: freq / stride, n: valCols.length });
  }

  const dataSql = `SELECT (json_object('ch',json_object(${chPieces.join(",")}),'ev',json_object(${evPieces.join(",")}),'wh',json_object(${whPieces.join(",")})))::VARCHAR AS doc`;
  const data = await duck(file, dataSql);

  outChannels.forEach(c => { c.data = (data.ch && data.ch[c.name]) || []; });
  const events = {};
  evNames.forEach(n => { events[n] = (data.ev && data.ev[n]) || []; });
  const wheels = {};
  wheelOut.forEach(w => {
    const d = (data.wh && data.wh[w.name]) || {};
    const arrs = []; for (let i = 1; i <= w.n; i++) arrs.push(d[String(i)] || []);
    wheels[w.name] = { unit: w.unit, freq: w.freq, wheels: arrs };  // [FL,FR,RL,RR]
  });

  return { file: path.basename(file), meta: cat.meta || {}, channels: outChannels, events, wheels };
}

async function loadSetup(file) {
  const setup = await duck(file, "SELECT value AS doc FROM metadata WHERE key='CarSetup'");
  if (!setup) return {};
  const o = {};
  for (const k in setup) { const e = setup[k] || {}; o[k] = { s: e.stringValue, v: e.value, min: e.minValue, max: e.maxValue, last: e.lastSavedStringValue }; }
  return o;
}

function sessionTimeFromName(file) {
  const m = file.match(/_(\d{4}-\d{2}-\d{2}T\d{2})_(\d{2})_(\d{2}Z)\.duckdb$/i);
  return m ? Date.parse(`${m[1]}:${m[2]}:${m[3]}`) || 0 : 0;
}

function listDirSessions(dir, src) {
  if (!dir) return [];
  try {
    return fs.readdirSync(dir).filter(f => /\.duckdb$/i.test(f)).map(f => {
      const st = fs.statSync(path.join(dir, f));
      return { file: f, size: st.size, mtime: st.mtimeMs, sessionTime: sessionTimeFromName(f), src };
    });
  } catch (e) {
    console.error("Dossier de télémétrie illisible (" + src + ") :", dir, e.message);
    return [];
  }
}
const INDEX_PATH = path.join(DATA_DIR, "session-index.json");
let SESSION_INDEX = {};
try { SESSION_INDEX = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8")) || {}; } catch (_) { SESSION_INDEX = {}; }
function saveSessionIndex() {
  try { fs.writeFileSync(INDEX_PATH, JSON.stringify(SESSION_INDEX)); } catch (_) {}
}
function metaStr(v) {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object") {
    if (v.stringValue != null && v.stringValue !== "") return String(v.stringValue);
    if (v.value != null && v.value !== "") return String(v.value);
  }
  return "";
}

const INDEX_VER = 3;
function normalizeClassKey(cls) {
  const s = String(cls || "").toUpperCase();
  if (!s) return "";
  if (/GT3|LMGT3/.test(s)) return "GT3";
  if (/LMP2|^P2\b/.test(s)) return "P2";
  if (/LMP3|^P3\b/.test(s)) return "P3";
  if (/HYPERCAR|\bHY\b|\bLMH\b|\bLMDH\b/.test(s)) return "HY";
  return s;
}
function pickLayout(raw) {
  return metaStr(raw.TrackLayout) || metaStr(raw.Layout) || metaStr(raw.TrackConfig)
    || metaStr(raw.TrackConfiguration) || metaStr(raw.CircuitLayout) || "";
}
function lightLapsFromRaw(raw) {
  const arr = Array.isArray(raw && raw.laps) ? raw.laps : [];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    const lapTime = typeof v === "number" ? v : Number(v && (v.lapTime != null ? v.lapTime : v));
    if (!(lapTime > 20)) continue;
    out.push({ lapIndex: out.length, lapTime });
  }
  return out;
}
async function loadSessionMeta(full) {
  const sqlFull = `SELECT (json_object(
    'CarName', (SELECT value FROM metadata WHERE key='CarName' LIMIT 1),
    'TrackName', (SELECT value FROM metadata WHERE key='TrackName' LIMIT 1),
    'TrackLayout', (SELECT value FROM metadata WHERE key='TrackLayout' LIMIT 1),
    'Layout', (SELECT value FROM metadata WHERE key='Layout' LIMIT 1),
    'TrackConfig', (SELECT value FROM metadata WHERE key='TrackConfig' LIMIT 1),
    'TrackConfiguration', (SELECT value FROM metadata WHERE key='TrackConfiguration' LIMIT 1),
    'CircuitLayout', (SELECT value FROM metadata WHERE key='CircuitLayout' LIMIT 1),
    'CarClass', (SELECT value FROM metadata WHERE key='CarClass' LIMIT 1),
    'SessionType', (SELECT value FROM metadata WHERE key='SessionType' LIMIT 1),
    'RecordingTime', (SELECT value FROM metadata WHERE key='RecordingTime' LIMIT 1),
    'nLaps', COALESCE((SELECT count(*) FROM "Lap Time" WHERE try_cast(value AS DOUBLE) > 20), 0),
    'laps', (SELECT to_json(list(try_cast(value AS DOUBLE) ORDER BY ts)) FROM "Lap Time" WHERE try_cast(value AS DOUBLE) > 20),
    'pits', COALESCE((SELECT to_json(list(dur ORDER BY dur)) FROM (
      SELECT lead(ts) OVER (ORDER BY ts) - ts AS dur, value FROM "In Pits"
    ) s WHERE value = 1 AND dur BETWEEN 5 AND 400), '[]'),
    'fuelMax', (SELECT max(try_cast(value AS DOUBLE)) FROM "Fuel Level")
  ))::VARCHAR AS doc`;
  const sqlBase = `SELECT (json_object(
    'CarName', (SELECT value FROM metadata WHERE key='CarName' LIMIT 1),
    'TrackName', (SELECT value FROM metadata WHERE key='TrackName' LIMIT 1),
    'TrackLayout', (SELECT value FROM metadata WHERE key='TrackLayout' LIMIT 1),
    'Layout', (SELECT value FROM metadata WHERE key='Layout' LIMIT 1),
    'TrackConfig', (SELECT value FROM metadata WHERE key='TrackConfig' LIMIT 1),
    'TrackConfiguration', (SELECT value FROM metadata WHERE key='TrackConfiguration' LIMIT 1),
    'CircuitLayout', (SELECT value FROM metadata WHERE key='CircuitLayout' LIMIT 1),
    'CarClass', (SELECT value FROM metadata WHERE key='CarClass' LIMIT 1),
    'SessionType', (SELECT value FROM metadata WHERE key='SessionType' LIMIT 1),
    'RecordingTime', (SELECT value FROM metadata WHERE key='RecordingTime' LIMIT 1),
    'nLaps', COALESCE((SELECT count(*) FROM "Lap Time" WHERE try_cast(value AS DOUBLE) > 20), 0),
    'laps', (SELECT to_json(list(try_cast(value AS DOUBLE) ORDER BY ts)) FROM "Lap Time" WHERE try_cast(value AS DOUBLE) > 20)
  ))::VARCHAR AS doc`;
  const sqlPits = `SELECT (json_object(
    'pits', COALESCE((SELECT to_json(list(dur ORDER BY dur)) FROM (
      SELECT lead(ts) OVER (ORDER BY ts) - ts AS dur, value FROM "In Pits"
    ) s WHERE value = 1 AND dur BETWEEN 5 AND 400), '[]')
  ))::VARCHAR AS doc`;
  const sqlFuel = `SELECT (json_object(
    'fuelMax', (SELECT max(try_cast(value AS DOUBLE)) FROM "Fuel Level")
  ))::VARCHAR AS doc`;
  const sqlLite = `SELECT (json_object(
    'CarName', (SELECT value FROM metadata WHERE key='CarName' LIMIT 1),
    'TrackName', (SELECT value FROM metadata WHERE key='TrackName' LIMIT 1),
    'TrackLayout', (SELECT value FROM metadata WHERE key='TrackLayout' LIMIT 1),
    'Layout', (SELECT value FROM metadata WHERE key='Layout' LIMIT 1),
    'TrackConfig', (SELECT value FROM metadata WHERE key='TrackConfig' LIMIT 1),
    'CarClass', (SELECT value FROM metadata WHERE key='CarClass' LIMIT 1),
    'SessionType', (SELECT value FROM metadata WHERE key='SessionType' LIMIT 1),
    'RecordingTime', (SELECT value FROM metadata WHERE key='RecordingTime' LIMIT 1),
    'nLaps', 0,
    'laps', json_array()
  ))::VARCHAR AS doc`;
  try { return await duck(full, sqlFull); }
  catch (e) { if (!isMissingTable(e)) throw e; }
  let raw;
  try { raw = await duck(full, sqlBase); }
  catch (e) {
    if (!isMissingTable(e)) throw e;
    raw = await duck(full, sqlLite);
  }
  raw = raw || {};
  try {
    const extra = await duck(full, sqlPits);
    raw.pits = extra && extra.pits != null ? extra.pits : [];
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    raw.pits = [];
  }
  try {
    const extra = await duck(full, sqlFuel);
    raw.fuelMax = extra ? extra.fuelMax : null;
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    raw.fuelMax = null;
  }
  return raw;
}
function indexRecordFromRaw(st, raw) {
  const cls = metaStr(raw.CarClass);
  const laps = lightLapsFromRaw(raw);
  return {
    v: INDEX_VER,
    mtime: st.mtimeMs, size: st.size,
    car: metaStr(raw.CarName), track: metaStr(raw.TrackName),
    layout: pickLayout(raw || {}),
    class: cls, classKey: normalizeClassKey(cls),
    stype: metaStr(raw.SessionType),
    date: metaStr(raw.RecordingTime),
    nLaps: Number(raw.nLaps) || laps.length || 0,
    laps,
    pits: pitDursFromRaw(raw.pits),
    fuelMax: Number(raw.fuelMax) > 1 ? Number(raw.fuelMax) : null
  };
}
function pitDursFromRaw(raw) {
  let arr = raw;
  if (typeof arr === "string") { try { arr = JSON.parse(arr); } catch (_) { arr = []; } }
  if (!Array.isArray(arr)) return [];
  return arr.map(Number).filter(d => d > 5 && d < 400);
}
function publicSessionMeta(name, rec) {
  return {
    file: name, car: rec.car, track: rec.track, layout: rec.layout || "",
    class: rec.class, classKey: rec.classKey || normalizeClassKey(rec.class),
    stype: rec.stype, date: rec.date || "", nLaps: rec.nLaps,
    laps: rec.laps || [],
    pits: rec.pits || [],
    fuelMax: rec.fuelMax || null
  };
}
function enrichSession(s) {
  const e = SESSION_INDEX[s.file];
  if (e && e.v === INDEX_VER && e.mtime === s.mtime && e.size === s.size) {
    return {
      ...s, car: e.car, track: e.track, layout: e.layout || "",
      class: e.class, classKey: e.classKey || normalizeClassKey(e.class),
      stype: e.stype, date: e.date || "", nLaps: e.nLaps, laps: e.laps || [],
      pits: e.pits || [], fuelMax: e.fuelMax || null
    };
  }
  return s;
}
function listSessions() {
  const dirs = telDirs();
  if (!dirs.length)
    return { error: "Telemetrie-Ordner nicht gefunden", telDir: null, lmuDir: null, manualDir: null, downloadsDir: null, sessions: [], ...publicDirs() };
  let files = [];
  try {
    files = dirs.flatMap(d => listDirSessions(d.dir, d.src))
      .sort((a, b) => b.mtime - a.mtime || b.sessionTime - a.sessionTime || b.file.localeCompare(a.file) || a.src.localeCompare(b.src))
      .map(({ sessionTime, ...session }) => session);
  } catch (e) {
    return { error: String(e.message), telDir: TEL_DIR, lmuDir: TEL.lmuDir, manualDir: TEL.manualDir, downloadsDir: TEL.downloadsDir, sessions: [], ...publicDirs() };
  }
  const live = new Set(files.map(s => s.file));
  let pruned = false;
  Object.keys(SESSION_INDEX).forEach(f => { if (!live.has(f)) { delete SESSION_INDEX[f]; pruned = true; } });
  if (pruned) saveSessionIndex();
  return { telDir: TEL_DIR, lmuDir: TEL.lmuDir, manualDir: TEL.manualDir, downloadsDir: TEL.downloadsDir, sessions: files.map(enrichSession), ...publicDirs() };
}
function guestDir() {
  const d = path.join(DATA_DIR, "guest-sessions");
  try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
  return d;
}
function isGuestFileName(name) {
  return /^guest-[A-Za-z0-9][A-Za-z0-9._-]{0,140}\.duckdb$/i.test(name) && !name.includes("..");
}
function guestStoredName(original) {
  const base = path.basename(String(original || "session.duckdb")).replace(/\.duckdb$/i, "");
  const stem = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 60) || "session";
  return "guest-" + Date.now().toString(36) + "-" + stem + ".duckdb";
}
function pipeGuestUpload(req, dest, limit) {
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(dest);
    let settled = false;
    let n = 0;
    let header = Buffer.alloc(0);
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try { req.destroy(); } catch (_) {}
      ws.destroy();
      fs.unlink(dest, () => {});
      reject(err);
    };
    req.on("data", (chunk) => {
      if (settled) return;
      n += chunk.length;
      if (n > limit) return fail(Object.assign(new Error("fichier trop volumineux"), { status: 413 }));
      if (header.length < 4) {
        header = Buffer.concat([header, chunk.subarray(0, Math.min(chunk.length, 4 - header.length))]);
        if (header.length >= 4 && header.subarray(0, 4).toString("utf8") !== "DUCK")
          return fail(Object.assign(new Error("pas un fichier DuckDB"), { status: 422 }));
      }
      if (!ws.write(chunk)) req.pause();
    });
    ws.on("drain", () => { try { req.resume(); } catch (_) {} });
    req.on("end", () => {
      if (settled) return;
      if (n < 128 || header.subarray(0, 4).toString("utf8") !== "DUCK")
        return fail(Object.assign(new Error("pas un fichier DuckDB"), { status: 422 }));
      ws.end(() => { if (!settled) { settled = true; resolve(n); } });
    });
    req.on("error", fail);
    ws.on("error", fail);
  });
}
async function importGuestSession(req, res) {
  let original = "session.duckdb";
  try { original = decodeURIComponent(req.headers["x-filename"] || original); } catch (_) {}
  const stored = guestStoredName(original);
  const dest = path.join(guestDir(), stored);
  try {
    const bytes = await pipeGuestUpload(req, dest, 512 * 1024 * 1024);
    await loadSessionMeta(dest);
    return json(res, 200, { file: stored, src: "guest", bytes, original: path.basename(original) });
  } catch (e) {
    try { fs.unlinkSync(dest); } catch (_) {}
    const msg = duckLockMsg(e);
    const status = e.status || (isInvalidDb(msg) ? 422 : 500);
    const error = status === 422 ? "Keine gültige LMU-Telemetrie (DuckDB)" : (status === 413 ? "Datei zu groß" : msg.slice(0, 400));
    return json(res, status, { error });
  }
}
function deleteGuestSession(name) {
  if (!isGuestFileName(name)) return { ok: false, status: 400, error: "Ungültiger Dateiname" };
  const full = path.join(guestDir(), name);
  try { fs.unlinkSync(full); } catch (e) { if (e.code !== "ENOENT") return { ok: false, status: 500, error: e.message }; }
  return { ok: true, status: 200 };
}
function resolveSessionFile(name, src) {
  if (src === "guest") {
    if (!isGuestFileName(name)) return null;
    const dir = guestDir();
    const full = path.join(dir, name);
    if (fs.existsSync(full)) return { full, src: "guest", dir };
    return null;
  }
  const known = telDirs();
  const preferred = known.find(d => d.src === src);
  const order = preferred ? [preferred, ...known.filter(d => d !== preferred)] : known;
  const seen = new Set();
  for (const entry of order) {
    const key = entry.dir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const full = path.join(entry.dir, name);
    if (fs.existsSync(full)) return { full, src: entry.src, dir: entry.dir };
  }
  return null;
}

function sqlStr(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

function duckLockMsg(e) {
  const stderr = e && e.stderr ? e.stderr.toString() : "";
  return stderr || String((e && e.message) || e);
}
function isInvalidDb(msg) {
  return /not a valid DuckDB database/i.test(msg);
}
function isMissingTable(e) {
  const msg = duckLockMsg(e);
  return /Catalog Error/i.test(msg) && /does not exist/i.test(msg);
}
function isLockErr(msg) {
  if (isInvalidDb(msg)) return false;
  // Kein pauschales "IO Error": DuckDB nutzt das auch für kaputte Dateien.
  return /lock|in use|conflicting|being used|could not set|already open|another process|verwendet wird|zugreifen|cannot open file/i.test(msg);
}
function sessionOpenError(res, msg) {
  if (isLockErr(msg))
    return json(res, 423, { locked: true, error: "Aufnahme läuft – Datei ist gesperrt" });
  if (isInvalidDb(msg))
    return json(res, 422, { error: "Keine gültige DuckDB-Telemetriedatei" });
  return json(res, 500, { error: msg.slice(0, 800) });
}

/* ---- HTTP ---- */
async function handleRequest(req, res) {
  const u = new URL(req.url, "http://localhost");
  // CORS nur für lokale Origins – sonst könnte jede besuchte Website die
  // Telemetrie auslesen oder die Bridge per /api/quit beenden.
  const origin = req.headers.origin || "";
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin))
    res.setHeader("Access-Control-Allow-Origin", origin);
  if (u.pathname === "/" || u.pathname === "/index.html") {
    const html = loadHtml();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(html);
  }
  if (u.pathname === "/favicon.ico" || u.pathname === "/LOGO_LM2.svg" || u.pathname === "/LOGO_LM.svg") {
    const buf = loadLogo();
    if (!buf) { res.writeHead(404); return res.end(); }
    res.writeHead(200, {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=86400",
    });
    return res.end(buf);
  }
  if (u.pathname === "/api/config") {
    return json(res, 200, { telDir: TEL_DIR, lmuDir: TEL.lmuDir, manualDir: TEL.manualDir, downloadsDir: TEL.downloadsDir, port: PORT, duckdb: fs.existsSync(DUCKDB), version: APP_VERSION, ...publicDirs() });
  }
  if (u.pathname === "/api/version") {
    return new Promise(resolve => {
      getLatestVersion((latest, url) => {
        json(res, 200, { current: APP_VERSION, latest: latest, url: url, repo: REPO });
        resolve();
      });
    });
  }
  if (u.pathname === "/api/quit") {
    json(res, 200, { ok: true });
    console.log("Arrêt demandé — le pont s'arrête.");
    setTimeout(() => process.exit(0), 250);
    return;
  }
  if (u.pathname === "/api/sessions") {
    return json(res, 200, listSessions());
  }
  if (u.pathname === "/api/session-meta") {
    const name = u.searchParams.get("file") || "";
    const src = u.searchParams.get("src") || "";
    if (!name || /[\\/]/.test(name) || !/\.duckdb$/i.test(name)) return json(res, 400, { error: "Ungültiger Dateiname" });
    if (src && src !== "lmu" && src !== "manual" && src !== "downloads" && src !== "extra" && src !== "guest") return json(res, 400, { error: "Ungültige Quelle" });
    const resolved = resolveSessionFile(name, src);
    if (!resolved) return json(res, 404, { error: "Datei nicht gefunden" });
    try {
      const st = fs.statSync(resolved.full);
      const cached = SESSION_INDEX[name];
      if (cached && cached.v === INDEX_VER && cached.mtime === st.mtimeMs && cached.size === st.size) {
        return json(res, 200, publicSessionMeta(name, cached));
      }
      const raw = await loadSessionMeta(resolved.full) || {};
      const rec = indexRecordFromRaw(st, raw);
      SESSION_INDEX[name] = rec; saveSessionIndex();
      return json(res, 200, publicSessionMeta(name, rec));
    } catch (e) {
      const msg = duckLockMsg(e);
      return sessionOpenError(res, msg);
    }
  }
  if (u.pathname === "/api/session") {
    const name = u.searchParams.get("file") || "";
    const src = u.searchParams.get("src") || "";
    if (!name || /[\\/]/.test(name) || !/\.duckdb$/i.test(name)) return json(res, 400, { error: "Ungültiger Dateiname" });
    if (src && src !== "lmu" && src !== "manual" && src !== "downloads" && src !== "extra" && src !== "guest") return json(res, 400, { error: "Ungültige Quelle" });
    if (src !== "guest" && !telDirs().length) return json(res, 500, { error: "Telemetrie-Ordner unbekannt" });
    const resolved = resolveSessionFile(name, src);
    if (!resolved) return json(res, 404, { error: "Datei nicht gefunden" });
    try {
      const t0 = Date.now();
      const data = await loadSession(resolved.full);
      data.loadMs = Date.now() - t0;
      data.src = resolved.src;
      data.telDir = resolved.dir;
      return json(res, 200, data);
    } catch (e) {
      const msg = duckLockMsg(e);
      console.error("[/api/session] Erreur :", msg.slice(0, 1000));
      return sessionOpenError(res, msg);
    }
  }
  if (u.pathname === "/api/setup") {
    const name = u.searchParams.get("file") || "";
    const src = u.searchParams.get("src") || "";
    if (!name || /[\\/]/.test(name) || !/\.duckdb$/i.test(name)) return json(res, 400, { error: "Ungültiger Dateiname" });
    if (src && src !== "lmu" && src !== "manual" && src !== "downloads" && src !== "extra" && src !== "guest") return json(res, 400, { error: "Ungültige Quelle" });
    if (src !== "guest" && !telDirs().length) return json(res, 500, { error: "Telemetrie-Ordner unbekannt" });
    const resolved = resolveSessionFile(name, src);
    if (!resolved) return json(res, 404, { error: "Datei nicht gefunden" });
    const full = resolved.full;
    try {
      return json(res, 200, { setup: await loadSetup(full) });
    } catch (e) {
      const msg = duckLockMsg(e);
      return sessionOpenError(res, msg);
    }
  }
  if (u.pathname === "/api/telemetry-dirs" && req.method === "GET") {
    return json(res, 200, publicDirs());
  }
  if (u.pathname === "/api/telemetry-dirs" && req.method === "POST") {
    const body = await readJsonBody(req, 8000);
    const added = addExtraDir(body.path);
    return json(res, added.status, added.ok ? added : { error: added.error });
  }
  if (u.pathname === "/api/telemetry-dirs" && req.method === "DELETE") {
    return json(res, 200, removeExtraDir(u.searchParams.get("path") || ""));
  }
  if (u.pathname === "/api/pick-folder" && req.method === "POST") {
    try {
      const picked = await pickFolder();
      return json(res, 200, { path: picked || "" });
    } catch (e) {
      return json(res, 500, { error: String(e.message || e) });
    }
  }
  if (req.method === "POST" && u.pathname === "/api/guest-session") {
    return importGuestSession(req, res);
  }
  if (req.method === "DELETE" && u.pathname === "/api/guest-session") {
    const gone = deleteGuestSession(u.searchParams.get("file") || "");
    return json(res, gone.status, gone.ok ? { ok: true } : { error: gone.error });
  }
  res.writeHead(404); res.end("not found");
}
function onRequest(req, res) {
  handleRequest(req, res).catch(e => {
    try { json(res, 500, { error: String(e.message || e) }); } catch (_) {}
  });
}
const server = http.createServer(onRequest);
function json(res, code, obj) {
  if (res.headersSent) return;
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

ensureDuckDB();
loadHtml();
loadLogo();
function onListening() {
  console.log("======================================================");
  console.log("  LMU Analyse télémétrie v" + APP_VERSION);
  console.log("  ▶  Fenêtre d'application (adresse : http://localhost:" + PORT + ")");
  console.log("  Télémétrie LMU : " + (TEL.lmuDir || "introuvable"));
  console.log("  Télémétrie man. : " + (TEL.manualDir || "pas de dossier telemetry/"));
  console.log("  Téléchargements : " + (TEL.downloadsDir || "introuvable"));
  if (EXTRA_DIRS.length) console.log("  Dossiers ajoutés : " + EXTRA_DIRS.join(" | "));
  console.log("  DuckDB CLI :     " + (fs.existsSync(DUCKDB) ? "ok" : "MANQUANTE"));
  console.log("  (Pour quitter : ferme la fenêtre de l'app, bouton ⏻ ou Gestionnaire des tâches.)");
  console.log("======================================================");
  if (!ARG["no-open"]) setTimeout(openApp, 800);
}
function onListenError(err) {
  if (err.code === "EADDRINUSE") {
    console.error("Le port " + PORT + " est déjà utilisé par un autre programme.");
    if (!ARG["no-open"]) openBrowserTab();
    setTimeout(() => process.exit(2), 1500);
    return;
  }
  console.error(err);
  process.exit(1);
}
function startServers() {
  server.on("error", onListenError);
  // Nur Loopback – IPv4 und IPv6. Chromium löst localhost oft als ::1 auf;
  // ohne IPv6-Bind schlägt fetch() mit ERR_CONNECTION_REFUSED fehl.
  server.listen(PORT, "127.0.0.1", onListening);
  const server6 = http.createServer(onRequest);
  server6.on("error", err => {
    if (err.code === "EADDRINUSE" || err.code === "EADDRNOTAVAIL" || err.code === "EAFNOSUPPORT") return;
    console.error(err);
  });
  server6.listen(PORT, "::1");
}
function waitPortThenStart() {
  const t0 = Date.now();
  (function tick() {
    const s = net.createServer();
    s.once("error", () => {
      if (Date.now() - t0 > 5000) return startServers();
      setTimeout(tick, 150);
    });
    s.once("listening", () => s.close(() => startServers()));
    s.listen(PORT, "127.0.0.1");
  })();
}
function quitExistingThenStart() {
  const req = http.get("http://127.0.0.1:" + PORT + "/api/config", { timeout: 800 }, res => {
    let d = "";
    res.on("data", c => d += c);
    res.on("end", () => {
      let ours = false;
      try { const j = JSON.parse(d); ours = j && typeof j.duckdb === "boolean"; } catch (_) {}
      if (!ours) return startServers();
      console.log("Une instance est déjà en cours — redémarrage...");
      http.get("http://127.0.0.1:" + PORT + "/api/quit", { timeout: 800 }, r => {
        r.resume();
        waitPortThenStart();
      }).on("error", waitPortThenStart);
    });
  });
  req.on("error", () => startServers());
  req.on("timeout", () => { req.destroy(); startServers(); });
}
quitExistingThenStart();
