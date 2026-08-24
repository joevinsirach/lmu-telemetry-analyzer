/* ===========================================================================
   LMU Telemetrie-Bridge
   Liest die von Le Mans Ultimate aufgezeichneten DuckDB-Telemetriedateien
   (UserData\Telemetry\*.duckdb) über die mitgelieferte duckdb.exe und stellt
   sie als JSON bereit. Liefert außerdem die HTML-App aus (gleiche Origin).
   Start:  node lmu-bridge.js  [--dir="<Pfad zu UserData\Telemetry>"] [--port=8777]
   =========================================================================== */
"use strict";
const http = require("http");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync, execFile, exec, spawn } = require("child_process");

const ARG = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
}));
const PORT = parseInt(ARG.port || process.env.LMU_PORT || "8777", 10);
const HOST = ARG.host || process.env.LMU_HOST || "127.0.0.1";
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
const CHROME_PROFILE = path.join(DATA_DIR, "chrome-profile");
const REPO = "mzluzifer/lmu-telemetry-analyzer";
const APP_VERSION = "1.12.0";
const { LiveTelemetryService, MODES } = require("./lmu-live");
const liveService = new LiveTelemetryService({ mode: ARG["live-mode"] || process.env.LMU_LIVE_MODE || MODES.auto });
const FUEL_STRATEGY = path.join(__dirname, "fuel-strategy.js");
const SHARE_TOKEN_FILE = path.join(DATA_DIR, "live-share-token.json");
let HTML_BUF = null;
let VIEW_HTML_BUF = null;

function loadOrCreateShareToken() {
  try {
    if (fs.existsSync(SHARE_TOKEN_FILE)) {
      const j = JSON.parse(fs.readFileSync(SHARE_TOKEN_FILE, "utf8"));
      if (j && j.token) return j.token;
    }
  } catch (_) {}
  const token = crypto.randomBytes(16).toString("hex");
  try {
    fs.writeFileSync(SHARE_TOKEN_FILE, JSON.stringify({ token, created: Date.now() }, null, 2));
  } catch (_) {}
  return token;
}

const LIVE_SHARE_TOKEN = loadOrCreateShareToken();

function shareTokenValid(token) {
  return typeof token === "string" && token.length >= 16 && token === LIVE_SHARE_TOKEN;
}

function localOriginAllowed(origin) {
  if (!origin) return false;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  if (/^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(origin))
    return true;
  return false;
}
function loadHtml() {
  if (HTML_BUF) return HTML_BUF;
  try {
    HTML_BUF = fs.readFileSync(HTML);
    return HTML_BUF;
  } catch (e) {
    if (e.code !== "EPERM" && e.code !== "EACCES") throw e;
    const dest = path.join(DATA_DIR, "lmu-telemetry-analyzer.html");
    execFileSync("/bin/cp", ["-f", HTML, dest]);
    HTML_BUF = fs.readFileSync(dest);
    return HTML_BUF;
  }
}

function loadViewHtml() {
  if (VIEW_HTML_BUF) return VIEW_HTML_BUF;
  const base = loadHtml().toString("utf8");
  VIEW_HTML_BUF = Buffer.from(
    base.replace("<body>", '<body class="live-view">').replace(/poll\(\);[\s\S]*?setInterval\(poll, POLL_MS\);/, "")
  );
  return VIEW_HTML_BUF;
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
}

// DuckDB-CLI bei Bedarf herunterladen (Windows-.exe und macOS-Doppelklick)
function ensureDuckDB() {
  if (fs.existsSync(DUCKDB)) return;
  console.log("Lade DuckDB-CLI herunter (einmalig)...");
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
      console.error("DuckDB-CLI fehlt: " + DUCKDB);
      return;
    }
  } catch (e) { console.error("DuckDB-Download fehlgeschlagen:", e.message); }
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
      exec('start "" ' + url, { windowsHide: true });
    } else {
      const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
      child.unref();
    }
  } catch (e) {
    console.error("Browser konnte nicht geöffnet werden:", e.message);
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
  if (!browser) { console.log("Kein Edge/Chrome gefunden – öffne Standard-Browser."); return openBrowserTab(); }
  // Eigenes Profilverzeichnis erzwingt einen unabhängigen Browser-Prozess, dessen
  // Lebensdauer dem Fenster entspricht (sonst übergibt Edge/Chrome an eine bereits
  // laufende Instanz und der Kindprozess endet sofort).
  const profile = CHROME_PROFILE;
  try { fs.mkdirSync(profile, { recursive: true }); } catch (_) {}
  try {
    const child = spawn(browser, [
      "--app=" + url,
      "--user-data-dir=" + profile,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1400,900",
    ], { stdio: "ignore" });   // KEIN windowsHide: das würde Edges/Chromes GUI-Fenster verstecken (SW_HIDE)
    child.on("exit", () => { console.log("App-Fenster geschlossen – Bridge wird beendet."); process.exit(0); });
    child.on("error", e => { console.error("App-Fenster konnte nicht gestartet werden:", e.message); openBrowserTab(); });
  } catch (e) { console.error("App-Start fehlgeschlagen:", e.message); openBrowserTab(); }
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

/* ---- Telemetrie-Ordner finden ---- */
function findTelemetryDir() {
  if (ARG.dir) return ARG.dir;
  if (process.env.LMU_TELEMETRY_DIR) return process.env.LMU_TELEMETRY_DIR;
  const srcBase = process.env.LMU_APP_SRC || BASE;
  const localTel = path.join(srcBase, "telemetry");
  try { if (fs.existsSync(localTel)) return localTel; } catch {}
  const libs = [];
  const vdfs = [
    "C:\\Program Files (x86)\\Steam\\steamapps\\libraryfolders.vdf",
    "C:\\Program Files\\Steam\\steamapps\\libraryfolders.vdf",
  ];
  for (const v of vdfs) {
    try {
      const t = fs.readFileSync(v, "utf8");
      for (const m of t.matchAll(/"path"\s*"([^"]+)"/g)) libs.push(m[1].replace(/\\\\/g, "\\"));
    } catch {}
  }
  libs.push("D:\\SteamLibrary", "C:\\Program Files (x86)\\Steam", "E:\\SteamLibrary");
  for (const lib of libs) {
    const p = path.join(lib, "steamapps", "common", "Le Mans Ultimate", "UserData", "Telemetry");
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}
let TEL_DIR = findTelemetryDir();

/* ---- Gewünschte Kanäle (Name -> Ziel-Frequenz Hz fürs Downsampling) ---- */
const WANT_CH = {
  "Lap Dist": 10, "Ground Speed": 50, "Throttle Pos": 50, "Brake Pos": 50,
  "Steering Pos": 50, "Engine RPM": 25, "GPS Latitude": 10, "GPS Longitude": 10,
  "G Force Lat": 10, "G Force Long": 10, "Fuel Level": 5, "Virtual Energy": 5,
  "SoC": 5, "Wheel Speed": 25, "Steering Shaft Torque": 25, "Path Lateral": 10,
  "Ambient Temperature": 1, "Track Temperature": 1, "Wind Speed": 1, "Wind Heading": 1,
};
const WANT_EV = ["Gear", "Lap", "Lap Time", "Last Sector1", "Last Sector2",
  "Current Sector", "In Pits", "TC", "ABS", "TCLevel", "ABSLevel", "Best LapTime",
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

function listSessions() {
  if (!TEL_DIR) return { error: "Telemetrie-Ordner nicht gefunden", telDir: null, sessions: [] };
  let files = [];
  try {
    files = fs.readdirSync(TEL_DIR).filter(f => /\.duckdb$/i.test(f)).map(f => {
      const st = fs.statSync(path.join(TEL_DIR, f));
      return { file: f, size: st.size, mtime: st.mtimeMs, sessionTime: sessionTimeFromName(f) };
    }).sort((a, b) => b.mtime - a.mtime || b.sessionTime - a.sessionTime || b.file.localeCompare(a.file))
      .map(({ sessionTime, ...session }) => session);
  } catch (e) { return { error: String(e.message), telDir: TEL_DIR, sessions: [] }; }
  return { telDir: TEL_DIR, sessions: files };
}

function sqlStr(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

function duckLockMsg(e) {
  const stderr = e && e.stderr ? e.stderr.toString() : "";
  return stderr || String((e && e.message) || e);
}
function isLockErr(msg) {
  return /lock|in use|conflicting|being used|could not set|already open|another process|verwendet wird|zugreifen|cannot open file|io error/i.test(msg);
}

function pickLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net && net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "127.0.0.1";
}

/* ---- HTTP ---- */
async function handleRequest(req, res) {
  const u = new URL(req.url, "http://localhost");
  // CORS nur für lokale Origins – sonst könnte jede besuchte Website die
  // Telemetrie auslesen oder die Bridge per /api/quit beenden.
  const origin = req.headers.origin || "";
  if (localOriginAllowed(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  if (u.pathname === "/view") {
    const token = u.searchParams.get("token") || "";
    if (!shareTokenValid(token)) {
      res.writeHead(403, { "content-type": "text/html; charset=utf-8" });
      return res.end("<h1>403 – invalid or missing share token</h1>");
    }
    const html = loadViewHtml();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(html);
  }
  if (u.pathname === "/" || u.pathname === "/index.html") {
    const html = loadHtml();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(html);
  }
  if (u.pathname === "/favicon.ico") {
    res.writeHead(204, { "cache-control": "public, max-age=86400" });
    return res.end();
  }
  if (u.pathname === "/fuel-strategy.js") {
    try {
      const js = fs.readFileSync(FUEL_STRATEGY);
      res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-cache" });
      return res.end(js);
    } catch (e) {
      res.writeHead(404); return res.end("not found");
    }
  }
  if (u.pathname === "/api/live/share") {
    const lanIp = HOST === "0.0.0.0" ? pickLanIp() : HOST;
    const baseUrl = "http://" + (lanIp === "0.0.0.0" ? "127.0.0.1" : lanIp) + ":" + PORT;
    return json(res, 200, {
      token: LIVE_SHARE_TOKEN,
      viewUrl: baseUrl + "/view?token=" + LIVE_SHARE_TOKEN,
      streamUrl: baseUrl + "/api/live/stream?token=" + LIVE_SHARE_TOKEN,
      lanOnly: true,
      host: HOST,
      port: PORT,
    });
  }
  if (u.pathname === "/api/live") {
    const token = u.searchParams.get("token");
    if (token && !shareTokenValid(token)) return json(res, 403, { error: "Invalid share token" });
    const mode = u.searchParams.get("mode");
    if (mode === "mock" || mode === "shm" || mode === "auto") liveService.setMode(mode);
    return json(res, 200, liveService.snapshot());
  }
  if (u.pathname === "/api/live/mode") {
    if (req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      try {
        const j = JSON.parse(body || "{}");
        if (j.mode === "mock" || j.mode === "shm" || j.mode === "auto") liveService.setMode(j.mode);
      } catch (_) {}
    }
    const snap = liveService.snapshot();
    return json(res, 200, { mode: liveService.mode, connection: snap.connection, source: snap.source });
  }
  if (u.pathname === "/api/live/stream") {
    const token = u.searchParams.get("token");
    if (token && !shareTokenValid(token)) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      return res.end("Invalid share token");
    }
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(": connected\n\n");
    const mode = u.searchParams.get("mode");
    if (mode === "mock" || mode === "shm" || mode === "auto") liveService.setMode(mode);
    const tickMs = Math.max(50, Math.min(500, parseInt(u.searchParams.get("interval") || "100", 10) || 100));
    const timer = setInterval(() => {
      if (res.writableEnded) return;
      try {
        const payload = liveService.snapshot();
        res.write("data: " + JSON.stringify(payload) + "\n\n");
      } catch (_) {}
    }, tickMs);
    req.on("close", () => { clearInterval(timer); try { res.end(); } catch (_) {} });
    return;
  }
  if (u.pathname === "/api/config") {
    return json(res, 200, {
      telDir: TEL_DIR, port: PORT, host: HOST, duckdb: fs.existsSync(DUCKDB), version: APP_VERSION,
      live: { platform: process.platform, mode: liveService.mode, shareEnabled: true },
    });
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
    console.log("Beenden angefordert – Bridge wird gestoppt.");
    setTimeout(() => process.exit(0), 250);
    return;
  }
  if (u.pathname === "/api/sessions") {
    return json(res, 200, listSessions());
  }
  if (u.pathname === "/api/session") {
    const name = u.searchParams.get("file") || "";
    if (!name || /[\\/]/.test(name) || !/\.duckdb$/i.test(name)) return json(res, 400, { error: "Ungültiger Dateiname" });
    if (!TEL_DIR) return json(res, 500, { error: "Telemetrie-Ordner unbekannt" });
    const full = path.join(TEL_DIR, name);
    if (!fs.existsSync(full)) return json(res, 404, { error: "Datei nicht gefunden" });
    try {
      const t0 = Date.now();
      const data = await loadSession(full);
      data.loadMs = Date.now() - t0;
      return json(res, 200, data);
    } catch (e) {
      const msg = duckLockMsg(e);
      console.error("[/api/session] Fehler:", msg.slice(0, 1000));
      if (isLockErr(msg))
        return json(res, 423, { locked: true, error: "Aufnahme läuft – Datei ist gesperrt" });
      return json(res, 500, { error: msg.slice(0, 800) });
    }
  }
  if (u.pathname === "/api/setup") {
    const name = u.searchParams.get("file") || "";
    if (!name || /[\\/]/.test(name) || !/\.duckdb$/i.test(name)) return json(res, 400, { error: "Ungültiger Dateiname" });
    if (!TEL_DIR) return json(res, 500, { error: "Telemetrie-Ordner unbekannt" });
    const full = path.join(TEL_DIR, name);
    if (!fs.existsSync(full)) return json(res, 404, { error: "Datei nicht gefunden" });
    try {
      return json(res, 200, { setup: await loadSetup(full) });
    } catch (e) {
      const msg = duckLockMsg(e);
      if (isLockErr(msg))
        return json(res, 423, { locked: true, error: "Aufnahme läuft – Datei ist gesperrt" });
      return json(res, 500, { error: msg.slice(0, 500) });
    }
  }
  res.writeHead(404); res.end("not found");
}
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(e => {
    try { json(res, 500, { error: String(e.message || e) }); } catch (_) {}
  });
});
function json(res, code, obj) {
  if (res.headersSent) return;
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

ensureDuckDB();
loadHtml();
server.on("error", err => {
  if (err.code === "EADDRINUSE") {
    console.error("Port " + PORT + " bereits belegt – öffne die laufende Instanz.");
    if (!ARG["no-open"]) openApp();
    setTimeout(() => process.exit(0), 1200);
    return;
  }
  console.error(err);
  process.exit(1);
});
// Bind to loopback by default; use --host=0.0.0.0 for LAN viewers (share token required).
server.listen(PORT, HOST, () => {
  console.log("======================================================");
  console.log("  LMU Telemetrie-Analyse v" + APP_VERSION);
  console.log("  ▶  http://" + (HOST === "0.0.0.0" ? "127.0.0.1" : HOST) + ":" + PORT);
  if (HOST === "0.0.0.0") console.log("  LAN:  http://" + pickLanIp() + ":" + PORT + "/view?token=" + LIVE_SHARE_TOKEN);
  console.log("  Telemetrie:     " + (TEL_DIR || "NICHT GEFUNDEN – mit --dir=... angeben"));
  console.log("  DuckDB CLI:     " + (fs.existsSync(DUCKDB) ? "ok" : "FEHLT"));
  console.log("  (Beenden: App-Fenster schließen, ⏻-Button oder Task-Manager.)");
  console.log("======================================================");
  if (!ARG["no-open"]) setTimeout(openApp, 800);
});
