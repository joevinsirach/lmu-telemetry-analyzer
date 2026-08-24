"use strict";

const { normalizeTelemetry } = require("./lmu-normalize");

const MOCK_DRIVERS = [
  "A. Davidson", "B. Hartley", "C. Albuquerque", "Joevin SIRACH", "E. Nasr",
  "F. Vesti", "G. Menezes", "H. Kobayashi", "I. Calderón", "J. Lynn",
  "K. Pieters", "L. Vanthoor", "M. Jensen", "N. Müller", "O. Pla",
  "P. Scherer", "Q. Martins", "R. Taylor", "S. Buemi", "T. Bernhard",
];

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
      sector1Time: 41.2,
      sector2Time: 0,
      fuel: 42.5,
      fuelCapacity: 90,
      lapStartFuel: 44.7,
      maxLaps: 50,
      sessionTimeRemaining: 7200,
      seed: 42,
      yellowFlagState: 0,
    };
    this._last = Date.now();
    this._fuelLapSamples = [
      { lap: 4, fuelStart: 48.7, fuelEnd: 46.6 },
      { lap: 5, fuelStart: 46.6, fuelEnd: 44.5 },
      { lap: 6, fuelStart: 44.5, fuelEnd: 42.5 },
    ];
    this._standings = this._buildStandings();
  }

  _rand() {
    this.state.seed = (this.state.seed * 16807 + 0) % 2147483647;
    return (this.state.seed & 0xfffffff) / 2147483647;
  }

  _buildStandings() {
    const playerPlace = 4;
    const rows = [];
    for (let place = 1; place <= 20; place++) {
      const isPlayer = place === playerPlace;
      const gap = place === 1 ? 0 : (place - 1) * 1.8 + this._rand() * 0.4;
      rows.push({
        idx: place - 1,
        place,
        driverName: isPlayer ? "Joevin SIRACH" : MOCK_DRIVERS[place - 1],
        lastLapTime: 220 + this._rand() * 6 + (place - 1) * 0.05,
        bestLapTime: 218 + this._rand() * 4 + (place - 1) * 0.04,
        timeBehindLeader: gap,
        lapsBehindLeader: 0,
        timeBehindNext: place === 1 ? 0 : 0.8 + this._rand() * 0.5,
        lapDist: Math.max(0, this.state.lapDist - (playerPlace - place) * 180),
        isPlayer,
      });
    }
    return rows.sort((a, b) => a.place - b.place);
  }

  snapshot() {
    const now = Date.now();
    const dt = Math.min(0.25, (now - this._last) / 1000);
    this._last = now;
    this.state.elapsed += dt;

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
      const fuelStart = this.state.lapStartFuel != null ? this.state.lapStartFuel : fuelEnd + 2.1;
      this.state.lapNumber += 1;
      this.state.lastLap = 220 + this._rand() * 6;
      if (this.state.lastLap < this.state.bestLap) this.state.bestLap = this.state.lastLap;
      this.state.lapStart = this.state.elapsed;
      this.state.lapDist = 0;
      this.state.sector = 1;
      this.state.sector1Time = 0;
      this.state.sector2Time = 0;
      this.state.fuel = Math.max(0, fuelEnd - (2.0 + this._rand() * 0.3));
      this._fuelLapSamples.push({
        lap: prevLap,
        fuelStart,
        fuelEnd: this.state.fuel,
      });
      this.state.lapStartFuel = this.state.fuel;
      if (this._fuelLapSamples.length > 24) this._fuelLapSamples.shift();
    } else if (this.state.lapStartFuel == null) {
      this.state.lapStartFuel = this.state.fuel;
    }

    const lapTime = this.state.elapsed - this.state.lapStart;
    if (lapTime > 41 && this.state.sector === 1) {
      this.state.sector1Time = 41.2 + this._rand();
      this.state.sector = 2;
    } else if (lapTime > 82 && this.state.sector === 2) {
      this.state.sector2Time = 82.5 + this._rand();
      this.state.sector = 0;
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

  _buildRaw({ speedMs, rpm, gear, throttle, brake, steering, clutch, lapTime }) {
    const s = this.state;
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
        numVehicles: 20,
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
        timeGapPlaceAhead: 1.24,
        timeGapPlaceBehind: 0.87,
        wheels,
      },
      score: {
        driverName: "Joevin SIRACH",
        sector: s.sector,
        lapDist: s.lapDist,
        bestLapTime: s.bestLap,
        lastLapTime: s.lastLap,
        bestSector1: s.bestS1,
        bestSector2: s.bestS2,
        curSector1: s.sector1Time || (s.sector >= 1 ? lapTime : 0),
        curSector2: s.sector2Time || (s.sector === 0 ? lapTime : 0),
        place: 4,
        timeBehindLeader: 12.456,
        lapsBehindLeader: 0,
        timeBehindNext: 1.24,
      },
      standings: this._standings,
    };
  }
}

module.exports = { MockTelemetrySource };
