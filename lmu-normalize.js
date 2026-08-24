"use strict";

const WHEEL_LABELS = ["AVG", "AVD", "ARG", "ARD"];
const COMPOUND_TYPES = { 0: "Soft", 1: "Medium", 2: "Hard", 3: "Wet" };
const SESSION_TYPES = {
  0: "Test Day", 1: "Essais 1", 2: "Essais 2", 3: "Essais 3", 4: "Essais 4",
  5: "Qualif 1", 6: "Qualif 2", 7: "Qualif 3", 8: "Qualif 4", 9: "Warmup",
  10: "Course 1", 11: "Course 2", 12: "Course 3", 13: "Course 4",
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
    tires: [],
    brakes: [],
    ts: Date.now(),
  };

  if (!raw || state !== "connected") return payload;

  const scoringInfo = raw.scoringInfo || {};
  const telem = raw.telem || {};
  const score = raw.score || {};

  if (!raw.playerHasVehicle) {
    payload.connection.message = message || "Session active, waiting for player vehicle";
    payload.session = {
      track: scoringInfo.track || "",
      session_type: SESSION_TYPES[scoringInfo.session] || "Unknown",
      in_realtime: !!scoringInfo.inRealtime,
      max_laps: scoringInfo.maxLaps || null,
      session_time_remaining: scoringInfo.sessionTimeRemaining ?? null,
    };
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

  payload.laps = {
    lap_number: telem.lapNumber | 0,
    current: formatLapTime(currentLapTime),
    current_seconds: Math.round(currentLapTime * 1000) / 1000,
    last: formatLapTime(finite(score.lastLapTime)),
    best: formatLapTime(finite(score.bestLapTime)),
    sector: sectorIndex(score.sector | 0),
    sectors: {
      s1: formatLapTime(sector1),
      s2: formatLapTime(sector2Only),
      s3: formatLapTime(sector3),
    },
    best_sectors: {
      s1: formatLapTime(finite(score.bestSector1)),
      s2: formatLapTime(Math.max(0, finite(score.bestSector2) - finite(score.bestSector1))),
      s3: formatLapTime(Math.max(0, finite(score.bestLapTime) - finite(score.bestSector2))),
    },
  };

  payload.fuel = {
    liters: Math.round(fuelLiters * 100) / 100,
    capacity_liters: Math.round(fuelCapacity * 100) / 100,
    percent: fuelCapacity > 0 ? Math.round((fuelLiters / fuelCapacity) * 1000) / 10 : 0,
  };

  payload.position = {
    place: score.place || null,
    gap_ahead: finite(telem.timeGapPlaceAhead),
    gap_behind: finite(telem.timeGapPlaceBehind),
    gap_leader: finite(score.timeBehindLeader),
    laps_behind_leader: score.lapsBehindLeader | 0,
  };

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

module.exports = { normalizeTelemetry, formatLapTime, decodeBytes, SESSION_TYPES };
