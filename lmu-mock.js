"use strict";

const { normalizeTelemetry } = require("./lmu-normalize");

/** 8-car WEC-style field at Circuit de la Sarthe (player P4). */
const MOCK_FIELD = [
  { place: 1, driver: "S. Buemi", team: "Toyota GR010", car: "Toyota #8" },
  { place: 2, driver: "B. Hartley", team: "Porsche 963", car: "Porsche #6" },
  { place: 3, driver: "A. Fuoco", team: "Ferrari 499P", car: "Ferrari #50" },
  { place: 4, driver: "Joevin SIRACH", team: "Toyota GR010", car: "Toyota #7", isPlayer: true },
  { place: 5, driver: "M. Jensen", team: "Peugeot 9X8", car: "Peugeot #93" },
  { place: 6, driver: "R. Taylor", team: "Cadillac V-Series.R", car: "Cadillac #2" },
  { place: 7, driver: "E. Nasr", team: "Porsche 963", car: "Porsche #5" },
  { place: 8, driver: "L. Vanthoor", team: "BMW M Hybrid V8", car: "BMW #15" },
];

const FUEL_PER_LAP = 2.1;
const S1_SPLIT = 41.2;
const S2_SPLIT = 82.5;

class MockTelemetrySource {
  constructor() {
    this.state = {
      elapsed: 0,
      lapStart: 0,
      lapNumber: 7,
      lapDist: 4200,
      trackLength: 13600,
      bestLap: 222.456,
      lastLap: 223.891,
      bestS1: 41.123,
      bestS2: 82.456,
      sector: 2,
      sector1Time: 0,
      sector2Time: 0,
      fuel: 42.5,
      fuelCapacity: 90,
      lapStartFuel: 44.6,
      maxLaps: 50,
      sessionTimeRemaining: 7200,
      seed: 42,
      yellowFlagState: 0,
    };
    this._last = Date.now();
    this._fuelLapSamples = [
      { lap: 4, fuelStart: 48.7, fuelEnd: 46.6 },
      { lap: 5, fuelStart: 46.6, fuelEnd: 44.5 },
      { lap: 6, fuelStart: 44.5, fuelEnd: 42.4 },
    ];
    this._gapState = MOCK_FIELD.map((row, i) => ({
      place: row.place,
      gapLeader: i === 0 ? 0 : 1.4 + i * 1.85,
      gapNext: i === 0 ? 0 : 0.75 + (i % 3) * 0.12,
      lastLap: 223.5 + i * 0.08,
      lapDistOffset: (4 - row.place) * 220,
    }));
    this._standings = this._buildStandings();
  }

  _rand() {
    this.state.seed = (this.state.seed * 16807 + 0) % 2147483647;
    return (this.state.seed & 0xfffffff) / 2147483647;
  }

  _driftGaps(dt) {
    for (let i = 1; i < this._gapState.length; i++) {
      const g = this._gapState[i];
      const wobble = Math.sin(this.state.elapsed * 0.07 + i * 1.3) * 0.015;
      g.gapLeader = Math.max(0.05, g.gapLeader + wobble * dt * 4);
      g.gapNext = Math.max(0.05, g.gapNext + Math.sin(this.state.elapsed * 0.11 + i) * 0.004 * dt);
      if (i > 1) {
        this._gapState[i].gapLeader = Math.max(
          this._gapState[i - 1].gapLeader + 0.05,
          this._gapState[i].gapLeader
        );
      }
    }
  }

  _buildStandings() {
    const playerPlace = 4;
    return MOCK_FIELD.map((row) => {
      const gs = this._gapState.find((g) => g.place === row.place) || {};
      const isPlayer = !!row.isPlayer;
      return {
        idx: row.place - 1,
        place: row.place,
        driverName: row.driver,
        lastLapTime: gs.lastLap || 223.8 + row.place * 0.05,
        bestLapTime: 221.9 + row.place * 0.04,
        timeBehindLeader: gs.gapLeader ?? 0,
        lapsBehindLeader: 0,
        timeBehindNext: row.place === 1 ? 0 : gs.gapNext ?? 0.8,
        lapDist: Math.max(0, this.state.lapDist + (gs.lapDistOffset || 0)),
        isPlayer,
      };
    }).sort((a, b) => a.place - b.place);
  }

  snapshot() {
    const now = Date.now();
    const dt = Math.min(0.25, (now - this._last) / 1000);
    this._last = now;
    this.state.elapsed += dt;
    this._driftGaps(dt);

    const phase = (this.state.lapDist / this.state.trackLength) * Math.PI * 2;
    let speedMs = 55 + 35 * Math.sin(phase * 1.7) + 10 * Math.sin(phase * 5.3);
    speedMs = Math.max(18, speedMs);
    let rpm = 4500 + 4000 * (speedMs / 90) + 500 * Math.sin(this.state.elapsed * 3.1);
    rpm = Math.min(8500, Math.max(3500, rpm));

    const throttle = Math.max(0, Math.min(1, 0.55 + 0.35 * Math.sin(phase * 2)));
    const brake = Math.max(0, Math.min(1, 0.4 * Math.max(0, Math.sin(phase * 2 + Math.PI))));
    const steering = Math.max(-1, Math.min(1, 0.65 * Math.sin(phase * 3.2)));
    const clutch = rpm < 4200 ? 0.05 : 0;

    const prevLap = this.state.lapNumber;
    this.state.lapDist += speedMs * dt;
    if (this.state.lapDist >= this.state.trackLength) {
      const fuelEnd = this.state.fuel;
      const fuelStart = this.state.lapStartFuel != null ? this.state.lapStartFuel : fuelEnd + FUEL_PER_LAP;
      this.state.lapNumber += 1;
      this.state.lastLap = 222 + this._rand() * 4;
      if (this.state.lastLap < this.state.bestLap) this.state.bestLap = this.state.lastLap;
      this.state.lapStart = this.state.elapsed;
      this.state.lapDist = 0;
      this.state.sector = 1;
      this.state.sector1Time = 0;
      this.state.sector2Time = 0;
      this.state.fuel = Math.max(0, fuelEnd - (FUEL_PER_LAP + (this._rand() - 0.5) * 0.08));
      this._fuelLapSamples.push({ lap: prevLap, fuelStart, fuelEnd: this.state.fuel });
      this.state.lapStartFuel = this.state.fuel;
      if (this._fuelLapSamples.length > 24) this._fuelLapSamples.shift();
      const playerGs = this._gapState.find((g) => g.place === 4);
      if (playerGs) playerGs.lastLap = this.state.lastLap;
    } else if (this.state.lapStartFuel == null) {
      this.state.lapStartFuel = this.state.fuel;
    }

    const lapTime = this.state.elapsed - this.state.lapStart;
    if (lapTime >= S1_SPLIT && this.state.sector === 1) {
      this.state.sector1Time = S1_SPLIT + (this._rand() - 0.5) * 0.25;
      this.state.sector = 2;
    } else if (lapTime >= S2_SPLIT && this.state.sector === 2) {
      this.state.sector2Time = S2_SPLIT + (this._rand() - 0.5) * 0.3;
      this.state.sector = 3;
    }

    const gear = speedMs < 35 ? 2 : speedMs < 55 ? 3 : speedMs < 75 ? 4 : speedMs < 95 ? 5 : 6;
    this._standings = this._buildStandings();
    const raw = this._buildRaw({ speedMs, rpm, gear, throttle, brake, steering, clutch, lapTime });

    return normalizeTelemetry({
      source: "mock",
      state: "connected",
      raw,
      gameVersion: 120,
      message: "Demo mode active",
    });
  }

  _sectorTimes(lapTime) {
    const s = this.state;
    if (s.sector === 1) {
      return { curSector1: lapTime, curSector2: 0 };
    }
    if (s.sector === 2) {
      const s1 = s.sector1Time > 0 ? s.sector1Time : Math.min(lapTime, S1_SPLIT);
      return { curSector1: s1, curSector2: lapTime };
    }
    const s1 = s.sector1Time > 0 ? s.sector1Time : S1_SPLIT;
    const s2cum = s.sector2Time > 0 ? s.sector2Time : Math.max(s1, lapTime);
    return { curSector1: s1, curSector2: s2cum };
  }

  _buildRaw({ speedMs, rpm, gear, throttle, brake, steering, clutch, lapTime }) {
    const s = this.state;
    const sectors = this._sectorTimes(lapTime);
    const wheels = [];
    const baseTemps = [95, 98, 96, 94];
    for (let i = 0; i < 4; i++) {
      const avgC = baseTemps[i] + 8 * Math.sin(s.elapsed * 0.4 + i);
      const kelvin = avgC + 273.15;
      wheels.push({
        temperature: [kelvin - 2, kelvin, kelvin + 2],
        pressure: 165 + i * 0.5,
        wear: 0.12 + i * 0.01,
        brakeTemp: 420 + 40 * brake + i * 5,
        compoundType: 1,
      });
    }

    const fuelPerLap =
      this._fuelLapSamples.reduce((sum, row) => sum + Math.max(0, row.fuelStart - row.fuelEnd), 0) /
      Math.max(1, this._fuelLapSamples.length);

    const playerGs = this._gapState.find((g) => g.place === 4) || {};
    const ahead = this._gapState.find((g) => g.place === 3);
    const behind = this._gapState.find((g) => g.place === 5);

    return {
      playerHasVehicle: true,
      trackLength: s.trackLength,
      fuelPerLapEstimate: fuelPerLap,
      fuelLapSamples: this._fuelLapSamples.slice(),
      scoringInfo: {
        track: "Circuit de la Sarthe",
        session: 10,
        inRealtime: true,
        ambientTemp: 18.5,
        trackTemp: 28,
        maxLaps: s.maxLaps,
        lapDist: s.lapDist,
        numVehicles: MOCK_FIELD.length,
        sessionTimeRemaining: Math.max(0, s.sessionTimeRemaining - s.elapsed * 0.02),
        endET: s.elapsed + s.sessionTimeRemaining,
        currentET: s.elapsed,
        playerName: "Joevin SIRACH",
        yellowFlagState: s.yellowFlagState,
      },
      telem: {
        vehicleName: "Toyota GR010 Hybrid",
        vehicleModel: "Toyota GR010",
        track: "Circuit de la Sarthe",
        lapNumber: s.lapNumber,
        lapStartET: s.lapStart,
        elapsedTime: s.elapsed,
        gear,
        maxGears: 6,
        engineRPM: rpm,
        engineMaxRPM: 8500,
        localVelX: speedMs,
        localVelZ: speedMs * 0.05,
        filteredThrottle: throttle,
        filteredBrake: brake,
        filteredSteering: steering,
        filteredClutch: clutch,
        fuel: s.fuel,
        fuelCapacity: s.fuelCapacity,
        frontCompoundName: "Medium",
        rearCompoundName: "Medium",
        timeGapPlaceAhead: ahead ? ahead.gapNext : 1.24,
        timeGapPlaceBehind: behind ? behind.gapNext : 0.87,
        wheels,
      },
      score: {
        driverName: "Joevin SIRACH",
        sector: s.sector === 3 ? 0 : s.sector,
        lapDist: s.lapDist,
        bestLapTime: s.bestLap,
        lastLapTime: s.lastLap,
        bestSector1: s.bestS1,
        bestSector2: s.bestS2,
        curSector1: sectors.curSector1,
        curSector2: sectors.curSector2,
        place: 4,
        timeBehindLeader: playerGs.gapLeader ?? 12.456,
        lapsBehindLeader: 0,
        timeBehindNext: ahead ? ahead.gapNext : 1.24,
      },
      standings: this._standings,
    };
  }
}

module.exports = { MockTelemetrySource, MOCK_FIELD, FUEL_PER_LAP };
