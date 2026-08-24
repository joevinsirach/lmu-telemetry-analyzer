"use strict";
/**
 * Fuel pit-strategy calculations (liters).
 * Used by the Live tab and unit-tested without LMU.
 */

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

const DEFAULT_FUEL_PER_LAP = 2.1;

/**
 * Estimate liters per lap from completed lap fuel deltas.
 * @param {Array<{lap:number,fuelStart:number,fuelEnd:number}>} lapSamples
 * @param {number|null} manualOverride L/tour when live data insufficient
 * @param {number|null} defaultPerLap fallback when no samples (e.g. ~2.1 L/tour)
 */
function fuelPerLapFromSamples(lapSamples, manualOverride, defaultPerLap) {
  const manual = manualOverride != null && manualOverride > 0 ? finite(manualOverride) : null;
  const fallback =
    defaultPerLap != null && defaultPerLap > 0
      ? finite(defaultPerLap)
      : DEFAULT_FUEL_PER_LAP;
  const samples = (lapSamples || []).filter(
    (s) => s && s.fuelStart > s.fuelEnd && s.fuelEnd >= 0 && s.fuelStart > 0
  );
  if (!samples.length) return manual != null ? manual : fallback;
  const perLap = samples.map((s) => s.fuelStart - s.fuelEnd);
  const avg = perLap.reduce((a, b) => a + b, 0) / perLap.length;
  if (!(avg > 0)) return manual != null ? manual : fallback;
  return manual != null ? avg * 0.65 + manual * 0.35 : avg;
}

/**
 * Liters consumed since stint start.
 */
function fuelConsumedStint(fuelAtStintStart, currentFuel) {
  const start = finite(fuelAtStintStart);
  const now = finite(currentFuel);
  if (!(start > 0) || !(now >= 0)) return 0;
  return Math.max(0, start - now);
}

/**
 * Remaining race distance expressed in laps (ceil when derived from time).
 */
function remainingLaps({ currentLap, totalLaps, remainingTimeSec, lapTimeSec }) {
  if (totalLaps != null && totalLaps > 0 && currentLap != null) {
    return Math.max(0, Math.ceil(totalLaps - currentLap));
  }
  if (remainingTimeSec != null && remainingTimeSec > 0 && lapTimeSec != null && lapTimeSec > 0) {
    return Math.max(0, Math.ceil(remainingTimeSec / lapTimeSec));
  }
  return null;
}

/**
 * Liters still required beyond what's in the tank to reach the end of the race.
 */
function fuelMissingToFinish({ currentFuel, remainingLaps, fuelPerLap }) {
  const fuel = finite(currentFuel);
  const laps = finite(remainingLaps);
  const per = finite(fuelPerLap);
  if (!(laps > 0) || !(per > 0)) return { neededTotal: 0, missing: 0, canFinish: fuel > 0 };
  const neededTotal = laps * per;
  const missing = Math.max(0, neededTotal - fuel);
  return {
    neededTotal,
    missing,
    canFinish: missing <= 0.05,
  };
}

/**
 * Liters to add at a pit stop on lap `pitLap` so the car can finish without running dry.
 * Accounts for fuel burned from now until the stop.
 */
function fuelToAddAtPit({
  currentLap,
  pitLap,
  currentFuel,
  tankCapacity,
  fuelPerLap,
  remainingLaps,
}) {
  const lapNow = Math.floor(finite(currentLap));
  const pit = Math.floor(finite(pitLap));
  const fuel = finite(currentFuel);
  const tank = finite(tankCapacity);
  const per = finite(fuelPerLap);
  const rem = finite(remainingLaps);

  if (!(pit > lapNow) || !(per > 0) || !(tank > 0) || !(rem > 0)) {
    return {
      pitLap: pit,
      lapsUntilPit: 0,
      fuelAtPitEntry: fuel,
      fuelNeededAfterPit: 0,
      addLiters: 0,
      feasible: false,
      overflows: false,
      runsDryBeforePit: false,
    };
  }

  const lapsUntilPit = pit - lapNow;
  const fuelAtPitEntry = fuel - lapsUntilPit * per;
  const lapsAfterPit = rem - lapsUntilPit;
  const fuelNeededAfterPit = Math.max(0, lapsAfterPit * per);
  const runsDryBeforePit = fuelAtPitEntry < 0;
  const rawAdd = fuelNeededAfterPit - Math.max(0, fuelAtPitEntry);
  const maxAdd = tank - Math.max(0, fuelAtPitEntry);
  const addLiters = clamp(rawAdd, 0, maxAdd);
  const overflows = rawAdd > maxAdd + 0.05;
  const feasible = !runsDryBeforePit && !overflows && addLiters >= 0;

  return {
    pitLap: pit,
    lapsUntilPit,
    fuelAtPitEntry,
    fuelNeededAfterPit,
    addLiters,
    feasible,
    overflows,
    runsDryBeforePit,
  };
}

/**
 * Build pit-stop table for candidate stop laps and pick a recommended stop.
 */
function buildPitStopTable(params) {
  const {
    currentLap,
    currentFuel,
    tankCapacity,
    fuelPerLap,
    remainingLaps,
    minPitLap,
    maxPitLap,
  } = params;

  const start = Math.max(Math.ceil(finite(currentLap)) + 1, Math.ceil(finite(minPitLap)));
  const end = Math.min(
    Math.ceil(finite(currentLap)) + Math.ceil(finite(remainingLaps)),
    Math.ceil(finite(maxPitLap))
  );

  const rows = [];
  for (let pit = start; pit <= end; pit++) {
    rows.push(
      fuelToAddAtPit({
        currentLap,
        pitLap: pit,
        currentFuel,
        tankCapacity,
        fuelPerLap,
        remainingLaps,
      })
    );
  }

  const finish = fuelMissingToFinish({ currentFuel, remainingLaps, fuelPerLap });
  let recommended = null;
  if (finish.canFinish) {
    recommended = rows.find((r) => r.addLiters <= 0.05 && r.feasible) || null;
  }
  if (!recommended) {
    recommended =
      rows.filter((r) => r.feasible && !r.runsDryBeforePit).sort((a, b) => a.addLiters - b.addLiters)[0] ||
      rows.filter((r) => !r.runsDryBeforePit).sort((a, b) => a.addLiters - b.addLiters)[0] ||
      null;
  }

  const lapsOnFuel =
    fuelPerLap > 0 ? finite(currentFuel) / finite(fuelPerLap) : null;

  return {
    rows,
    recommendedPitLap: recommended ? recommended.pitLap : null,
    lapsOnFuel,
    finish,
  };
}

function summarizeFuelStrategy(input) {
  const fuelPerLap = fuelPerLapFromSamples(
    input.lapSamples,
    input.manualFuelPerLap,
    input.defaultFuelPerLap
  );
  const rem = remainingLaps({
    currentLap: input.currentLap,
    totalLaps: input.totalLaps,
    remainingTimeSec: input.remainingTimeSec,
    lapTimeSec: input.lapTimeSec,
  });
  const consumed = fuelConsumedStint(input.fuelAtStintStart, input.currentFuel);
  const finish = fuelMissingToFinish({
    currentFuel: input.currentFuel,
    remainingLaps: rem,
    fuelPerLap,
  });
  const pitTable = rem != null
    ? buildPitStopTable({
        currentLap: input.currentLap,
        currentFuel: input.currentFuel,
        tankCapacity: input.tankCapacity,
        fuelPerLap,
        remainingLaps: rem,
        minPitLap: input.minPitLap,
        maxPitLap: input.maxPitLap ?? input.currentLap + rem,
      })
    : { rows: [], recommendedPitLap: null, lapsOnFuel: null, finish };

  return {
    fuelPerLap,
    consumedStint: consumed,
    remainingLaps: rem,
    missingToFinish: finish.missing,
    neededTotal: finish.neededTotal,
    canFinishWithoutPit: finish.canFinish,
    lapsOnFuel: pitTable.lapsOnFuel,
    pitRows: pitTable.rows,
    recommendedPitLap: pitTable.recommendedPitLap,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    finite,
    DEFAULT_FUEL_PER_LAP,
    fuelPerLapFromSamples,
    fuelConsumedStint,
    remainingLaps,
    fuelMissingToFinish,
    fuelToAddAtPit,
    buildPitStopTable,
    summarizeFuelStrategy,
  };
}
if (typeof window !== "undefined") {
  window.FuelStrategy = {
    fuelPerLapFromSamples,
    fuelConsumedStint,
    remainingLaps,
    fuelMissingToFinish,
    fuelToAddAtPit,
    buildPitStopTable,
    summarizeFuelStrategy,
  };
}
