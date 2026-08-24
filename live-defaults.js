"use strict";

const DEFAULT_MOCK_LAP_SEC = 222;

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * @param {{last_seconds?:number|null,best_seconds?:number|null,lap_number?:number|null,current_seconds?:number|null}} laps
 * @param {{session_time_remaining?:number|null,max_laps?:number|null}} session
 */
function defaultLiveLapSec(laps, session) {
  const last = finite(laps && laps.last_seconds);
  const best = finite(laps && laps.best_seconds);
  if (last > 30) return last;
  if (best > 30) return best;

  const remTime = finite(session && session.session_time_remaining);
  const maxLaps = finite(session && session.max_laps);
  const lapNo = finite(laps && laps.lap_number);
  if (remTime > 0 && maxLaps > 0 && lapNo > 0) {
    const remLaps = maxLaps - lapNo;
    if (remLaps > 0) {
      const est = remTime / remLaps;
      if (est > 30) return est;
    }
  }
  return DEFAULT_MOCK_LAP_SEC;
}

function lapTimeForRemaining({ lapTimeSec, laps, session }) {
  const manual = finite(lapTimeSec);
  if (manual >= 30) return manual;
  return defaultLiveLapSec(laps || {}, session || {});
}

const api = { DEFAULT_MOCK_LAP_SEC, defaultLiveLapSec, lapTimeForRemaining };

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}
if (typeof globalThis !== "undefined") {
  globalThis.LiveDefaults = api;
}
