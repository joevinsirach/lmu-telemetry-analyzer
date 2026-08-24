"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { defaultLiveLapSec, lapTimeForRemaining, DEFAULT_MOCK_LAP_SEC } = require("../live-defaults.js");
const { remainingLaps } = require("../fuel-strategy.js");
const { MockTelemetrySource } = require("../lmu-mock.js");

test("defaultLiveLapSec prefers last completed lap", () => {
  assert.equal(
    defaultLiveLapSec({ last_seconds: 223.891, best_seconds: 222.456, current_seconds: 0.5 }),
    223.891
  );
});

test("defaultLiveLapSec falls back to best lap when last missing", () => {
  assert.equal(
    defaultLiveLapSec({ last_seconds: 0.5, best_seconds: 222.456, current_seconds: 0.5 }),
    222.456
  );
});

test("defaultLiveLapSec ignores in-progress current_seconds (0.5s)", () => {
  const sec = defaultLiveLapSec({ current_seconds: 0.5, last_seconds: null, best_seconds: null });
  assert.equal(sec, DEFAULT_MOCK_LAP_SEC);
  assert.ok(sec >= 30);
});

test("lapTimeForRemaining never uses sub-30s manual or current lap", () => {
  const t = lapTimeForRemaining({
    lapTimeSec: 0.5,
    laps: { current_seconds: 0.5, last_seconds: 223.891 },
    session: {},
  });
  assert.equal(t, 223.891);
});

test("remainingLaps from time ignores 0.5s lap time", () => {
  const lapSec = lapTimeForRemaining({
    lapTimeSec: 0.5,
    laps: { last_seconds: 223.891, current_seconds: 0.5 },
    session: {},
  });
  assert.equal(remainingLaps({ remainingTimeSec: 3600, lapTimeSec: lapSec }), 17);
  assert.notEqual(remainingLaps({ remainingTimeSec: 3600, lapTimeSec: 0.5 }), 17);
});

test("mock snapshot has WEC field with >= 2 standings", () => {
  const mock = new MockTelemetrySource();
  const snap = mock.snapshot();
  assert.ok(Array.isArray(snap.standings));
  assert.ok(snap.standings.length >= 2);
  assert.ok(snap.standings.length >= 6 && snap.standings.length <= 10);
});

test("mock snapshot player is Joevin SIRACH P4 at La Sarthe", () => {
  const mock = new MockTelemetrySource();
  const snap = mock.snapshot();
  assert.equal(snap.vehicle.driver, "Joevin SIRACH");
  assert.equal(snap.position.place, 4);
  assert.match(snap.session.track, /Sarthe/i);
  const player = snap.standings.find((r) => r.is_player);
  assert.ok(player);
  assert.equal(player.driver, "Joevin SIRACH");
});

test("mock fuel samples average near 2.1 L/lap", () => {
  const mock = new MockTelemetrySource();
  let snap = mock.snapshot();
  for (let i = 0; i < 400; i++) snap = mock.snapshot();
  assert.ok(snap.fuel.lap_samples.length >= 3);
  const avg =
    snap.fuel.lap_samples.reduce((s, r) => s + (r.fuelStart - r.fuelEnd), 0) /
    snap.fuel.lap_samples.length;
  assert.ok(Math.abs(avg - 2.1) < 0.25);
});

test("mock last lap time is realistic, current lap can be tiny", () => {
  const mock = new MockTelemetrySource();
  const snap = mock.snapshot();
  assert.ok(snap.laps.last_seconds > 30);
  assert.ok(snap.laps.current_seconds >= 0);
});
