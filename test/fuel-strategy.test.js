"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const {
  fuelPerLapFromSamples,
  fuelConsumedStint,
  remainingLaps,
  fuelMissingToFinish,
  fuelToAddAtPit,
  buildPitStopTable,
  summarizeFuelStrategy,
} = require("../fuel-strategy.js");

test("fuelPerLapFromSamples averages completed laps", () => {
  const per = fuelPerLapFromSamples(
    [
      { lap: 1, fuelStart: 90, fuelEnd: 87.9 },
      { lap: 2, fuelStart: 87.9, fuelEnd: 85.8 },
    ],
    null
  );
  assert.ok(Math.abs(per - 2.1) < 0.01);
});

test("fuelPerLapFromSamples falls back to manual override", () => {
  assert.equal(fuelPerLapFromSamples([], 2.5), 2.5);
});

test("fuelPerLapFromSamples falls back to default when no samples", () => {
  assert.equal(fuelPerLapFromSamples([], null, 2.1), 2.1);
  assert.equal(fuelPerLapFromSamples([], null, null), 2.1);
});

test("fuelConsumedStint", () => {
  assert.equal(fuelConsumedStint(90, 42.5), 47.5);
});

test("remainingLaps from total laps", () => {
  assert.equal(remainingLaps({ currentLap: 7, totalLaps: 50 }), 43);
});

test("remainingLaps from remaining time", () => {
  assert.equal(
    remainingLaps({ remainingTimeSec: 3600, lapTimeSec: 222 }),
    17
  );
});

test("fuelMissingToFinish", () => {
  const r = fuelMissingToFinish({
    currentFuel: 42,
    remainingLaps: 10,
    fuelPerLap: 2.1,
  });
  assert.equal(r.neededTotal, 21);
  assert.ok(Math.abs(r.missing - 0) < 0.01);
  assert.equal(r.canFinish, true);
});

test("fuelMissingToFinish when short", () => {
  const r = fuelMissingToFinish({
    currentFuel: 10,
    remainingLaps: 10,
    fuelPerLap: 2.1,
  });
  assert.ok(Math.abs(r.missing - 11) < 0.01);
  assert.equal(r.canFinish, false);
});

test("fuelToAddAtPit computes refill for stop lap", () => {
  const r = fuelToAddAtPit({
    currentLap: 7,
    pitLap: 12,
    currentFuel: 42,
    tankCapacity: 90,
    fuelPerLap: 2.1,
    remainingLaps: 43,
  });
  assert.equal(r.lapsUntilPit, 5);
  assert.ok(Math.abs(r.fuelAtPitEntry - 31.5) < 0.01);
  assert.ok(r.addLiters > 0);
  assert.equal(r.feasible, true);
});

test("fuelToAddAtPit detects dry before pit", () => {
  const r = fuelToAddAtPit({
    currentLap: 7,
    pitLap: 30,
    currentFuel: 5,
    tankCapacity: 90,
    fuelPerLap: 2.1,
    remainingLaps: 43,
  });
  assert.equal(r.runsDryBeforePit, true);
});

test("buildPitStopTable recommends feasible stop", () => {
  const table = buildPitStopTable({
    currentLap: 7,
    currentFuel: 42,
    tankCapacity: 90,
    fuelPerLap: 2.1,
    remainingLaps: 43,
    minPitLap: 8,
    maxPitLap: 20,
  });
  assert.ok(table.rows.length > 0);
  assert.ok(table.recommendedPitLap != null);
  const rec = table.rows.find((r) => r.pitLap === table.recommendedPitLap);
  assert.ok(rec);
  assert.equal(rec.feasible, true);
});

test("summarizeFuelStrategy end-to-end", () => {
  const s = summarizeFuelStrategy({
    currentLap: 7,
    totalLaps: 50,
    currentFuel: 42,
    tankCapacity: 90,
    fuelAtStintStart: 90,
    manualFuelPerLap: 2.1,
    lapSamples: [{ lap: 6, fuelStart: 44.1, fuelEnd: 42 }],
  });
  assert.ok(s.fuelPerLap > 0);
  assert.equal(s.consumedStint, 48);
  assert.equal(s.remainingLaps, 43);
  assert.ok(Array.isArray(s.pitRows));
});
