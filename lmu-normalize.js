"use strict";

const WHEEL_LABELS = ["AVG", "AVD", "ARG", "ARD"];
const COMPOUND_TYPES = { 0: "Soft", 1: "Medium", 2: "Hard", 3: "Wet" };
const SESSION_TYPES = {
  0: "Test Day", 1: "Essais 1", 2: "Essais 2", 3: "Essais 3", 4: "Essais 4",
  5: "Qualif 1", 6: "Qualif 2", 7: "Qualif 3", 8: "Qualif 4", 9: "Warmup",
  10: "Course 1", 11: "Course 2", 12: "Course 3", 13: "Course 4",
};
const YELLOW_FLAG_LABELS = {
  "-1": "none",
  0: "none",
  1: "pending",
  2: "active",
  3: "last_lap",
  4: "resume",
  5: "active_waved",
  6: "active_waved_all",
};

function finite(value, fallback = 0) {
  if (value == null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function decodeBytes(bytes) {
  if (!bytes) return "";
  if (typeof bytes === "string") return bytes.replace(/\0/g, "").trim();
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return Buffer.from(bytes.subarray(0, end)).toString("utf8").trim();
}

function formatLapTime(seconds) {
  if (seconds <= 0 || !Number.isFinite(seconds)) return "--:--.---";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  if (minutes) return `${minutes}:${remainder.toFixed(3).padStart(6, "0")}`;
  return remainder.toFixed(3);
}

function kelvinToCelsius(value) {
  return finite(value) - 273.15;
}

function speedKmh(localVelX, localVelZ) {
  return Math.hypot(finite(localVelX), finite(localVelZ)) * 3.6;
}

function sectorIndex(rawSector) {
  if (rawSector === 1) return 1;
  if (rawSector === 2) return 2;
  return 3;
}

function formatGap(seconds, lapsBehind) {
  if (lapsBehind > 0) return `+${lapsBehind}L`;
  if (seconds > 0 && Number.isFinite(seconds)) return `+${seconds.toFixed(3)}`;
  if (seconds === 0) return "—";
  return "";
}

function normalizeStandings(rawStandings, playerPlace) {
  return (rawStandings || [])
    .filter((v) => v && v.place > 0 && v.driverName)
    .map((v) => ({
      place: v.place,
      driver: v.driverName,
      last_lap: formatLapTime(finite(v.lastLapTime)),
      last_lap_seconds: finite(v.lastLapTime) > 0 ? finite(v.lastLapTime) : null,
      best_lap_seconds: finite(v.bestLapTime) > 0 ? finite(v.bestLapTime) : null,
      gap_leader: formatGap(finite(v.timeBehindLeader), v.lapsBehindLeader | 0),
      gap_leader_seconds: finite(v.timeBehindLeader),
      laps_behind_leader: v.lapsBehindLeader | 0,
      gap_next_seconds: finite(v.timeBehindNext),
      is_player: !!v.isPlayer || v.place === playerPlace,
    }))
    .sort((a, b) => a.place - b.place);
}

function normalizeTelemetry({ source, state, raw, gameVersion = 0, message = "" }) {
  const payload = {
    source,
    connection: { state, game_version: gameVersion, message },
    session: {},
    vehicle: {},
    inputs: {},
    laps: {},
    fuel: {},
    position: {},
    track_progress: {},
    flags: {},
    standings: [],
    relative: [],
    tires: [],
    brakes: [],
    ts: Date.now(),
  };

  if (!raw || state !== "connected") return payload;

  const scoringInfo = raw.scoringInfo || {};
  const telem = raw.telem || {};
  const score = raw.score || {};
  const yellowKey = String(scoringInfo.yellowFlagState ?? -1);
  const yellowLabel = YELLOW_FLAG_LABELS[yellowKey] || "none";

  if (!raw.playerHasVehicle) {
    payload.connection.message = message || "Session active, waiting for player vehicle";
    payload.session = {
      track: scoringInfo.track || "",
      session_type: SESSION_TYPES[scoringInfo.session] || "Unknown",
      in_realtime: !!scoringInfo.inRealtime,
      max_laps: scoringInfo.maxLaps || null,
      session_time_remaining: scoringInfo.sessionTimeRemaining ?? null,
    };
    payload.flags = { yellow: yellowLabel !== "none", yellow_state: yellowLabel };
    payload.standings = normalizeStandings(raw.standings, null);
    return payload;
  }

  const currentLapTime = Math.max(0, finite(telem.elapsedTime) - finite(telem.lapStartET));
  const sector1 = finite(score.curSector1);
  const sector2 = finite(score.curSector2);
  let sector2Only = 0;
  let sector3 = 0;
  if (sector2 > 0 && sector1 > 0) {
    sector3 = Math.max(0, currentLapTime - sector2);
    sector2Only = Math.max(0, sector2 - sector1);
  } else if (sector1 > 0) {
    sector3 = Math.max(0, currentLapTime - sector1);
  }

  const fuelLiters = finite(telem.fuel);
  const fuelCapacity = finite(telem.fuelCapacity);
  const trackLength = finite(raw.trackLength) || null;
  const lapDist = finite(score.lapDist) || finite(scoringInfo.lapDist) || finite(raw.lapDist) || 0;
  const playerPlace = score.place || null;

  payload.session = {
    track: scoringInfo.track || telem.track || "",
    session_type: SESSION_TYPES[scoringInfo.session] || "Unknown",
    in_realtime: !!scoringInfo.inRealtime,
    ambient_temp_c: Math.round(finite(scoringInfo.ambientTemp) * 10) / 10,
    track_temp_c: Math.round(finite(scoringInfo.trackTemp) * 10) / 10,
    max_laps: scoringInfo.maxLaps || null,
    session_time_remaining: scoringInfo.sessionTimeRemaining ?? null,
    end_et: scoringInfo.endET || null,
    current_et: scoringInfo.currentET || null,
  };

  payload.flags = {
    yellow: yellowLabel !== "none" && yellowLabel !== "resume",
    yellow_state: yellowLabel,
  };

  payload.track_progress = {
    lap_dist_m: Math.round(lapDist * 10) / 10,
    track_length_m: trackLength,
    fraction: trackLength > 0 ? Math.max(0, Math.min(1, lapDist / trackLength)) : null,
  };

  const rpm = finite(telem.engineRPM);
  const maxRpm = Math.max(finite(telem.engineMaxRPM), 1);
  const shiftThreshold = maxRpm * 0.92;

  payload.vehicle = {
    name: telem.vehicleName || "",
    model: telem.vehicleModel || "",
    driver: score.driverName || scoringInfo.playerName || "",
    gear: telem.gear | 0,
    max_gears: telem.maxGears | 0,
    speed_kmh: Math.round(speedKmh(telem.localVelX, telem.localVelZ) * 10) / 10,
    rpm: Math.round(rpm),
    max_rpm: Math.round(maxRpm),
    shift_lights: rpm > 0 ? Math.min(8, Math.max(0, Math.floor((rpm / shiftThreshold) * 8))) : 0,
  };

  payload.inputs = {
    throttle: Math.round(finite(telem.filteredThrottle) * 1000) / 1000,
    brake: Math.round(finite(telem.filteredBrake) * 1000) / 1000,
    clutch: Math.round(finite(telem.filteredClutch) * 1000) / 1000,
    steering: Math.round(finite(telem.filteredSteering) * 1000) / 1000,
  };

  const lastLapSec = finite(score.lastLapTime);
  const bestLapSec = finite(score.bestLapTime);

  payload.laps = {
    lap_number: telem.lapNumber | 0,
    current: formatLapTime(currentLapTime),
    current_seconds: Math.round(currentLapTime * 1000) / 1000,
    last: formatLapTime(lastLapSec),
    last_seconds: lastLapSec > 0 ? Math.round(lastLapSec * 1000) / 1000 : null,
    best: formatLapTime(bestLapSec),
    best_seconds: bestLapSec > 0 ? Math.round(bestLapSec * 1000) / 1000 : null,
    sector: sectorIndex(score.sector | 0),
    sectors: {
      s1: formatLapTime(sector1),
      s1_seconds: sector1 > 0 ? Math.round(sector1 * 1000) / 1000 : null,
      s2: formatLapTime(sector2Only),
      s2_seconds: sector2Only > 0 ? Math.round(sector2Only * 1000) / 1000 : null,
      s3: formatLapTime(sector3),
      s3_seconds: sector3 > 0 ? Math.round(sector3 * 1000) / 1000 : null,
    },
    best_sectors: {
      s1: formatLapTime(finite(score.bestSector1)),
      s1_seconds: finite(score.bestSector1) > 0 ? finite(score.bestSector1) : null,
      s2: formatLapTime(Math.max(0, finite(score.bestSector2) - finite(score.bestSector1))),
      s2_seconds:
        finite(score.bestSector2) > 0
          ? Math.max(0, finite(score.bestSector2) - finite(score.bestSector1))
          : null,
      s3: formatLapTime(Math.max(0, finite(score.bestLapTime) - finite(score.bestSector2))),
      s3_seconds:
        finite(score.bestLapTime) > 0
          ? Math.max(0, finite(score.bestLapTime) - finite(score.bestSector2))
          : null,
    },
  };

  payload.fuel = {
    liters: Math.round(fuelLiters * 100) / 100,
    capacity_liters: Math.round(fuelCapacity * 100) / 100,
    percent: fuelCapacity > 0 ? Math.round((fuelLiters / fuelCapacity) * 1000) / 10 : 0,
    per_lap_estimate: raw.fuelPerLapEstimate != null ? finite(raw.fuelPerLapEstimate) : null,
    lap_samples: Array.isArray(raw.fuelLapSamples) ? raw.fuelLapSamples : [],
  };

  payload.position = {
    place: playerPlace,
    gap_ahead: finite(telem.timeGapPlaceAhead),
    gap_behind: finite(telem.timeGapPlaceBehind),
    gap_leader: finite(score.timeBehindLeader),
    laps_behind_leader: score.lapsBehindLeader | 0,
  };

  payload.standings = normalizeStandings(raw.standings, playerPlace);

  const rel = [];
  if (playerPlace != null) {
    const ahead = payload.standings.find((v) => v.place === playerPlace - 1);
    const behind = payload.standings.find((v) => v.place === playerPlace + 1);
    const leader = payload.standings.find((v) => v.place === 1);
    if (ahead) rel.push({ ...ahead, relation: "ahead" });
    if (behind) rel.push({ ...behind, relation: "behind" });
    if (leader && leader.place !== playerPlace) rel.unshift({ ...leader, relation: "leader" });
  }
  payload.relative = rel;

  const frontCompound = telem.frontCompoundName || "";
  const rearCompound = telem.rearCompoundName || "";
  (telem.wheels || []).forEach((wheel, idx) => {
    const label = WHEEL_LABELS[idx] || `W${idx}`;
    const temps = (wheel.temperature || []).map(kelvinToCelsius);
    const compoundType = COMPOUND_TYPES[wheel.compoundType] || "Unknown";
    payload.tires.push({
      corner: label,
      compound: (idx < 2 ? frontCompound : rearCompound) || compoundType,
      compound_type: compoundType,
      temperature_c: {
        left: Math.round(temps[0] * 10) / 10,
        center: Math.round(temps[1] * 10) / 10,
        right: Math.round(temps[2] * 10) / 10,
        avg: temps.length ? Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10 : 0,
      },
      pressure_kpa: Math.round(finite(wheel.pressure) * 10) / 10,
      wear: Math.round(finite(wheel.wear) * 1000) / 10,
    });
    payload.brakes.push({
      corner: label,
      temperature_c: Math.round(finite(wheel.brakeTemp) * 10) / 10,
    });
  });

  return payload;
}

module.exports = {
  normalizeTelemetry,
  formatLapTime,
  decodeBytes,
  SESSION_TYPES,
  YELLOW_FLAG_LABELS,
};
