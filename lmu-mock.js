"use strict";

const { normalizeTelemetry } = require("./lmu-normalize");

class MockTelemetrySource {
  constructor() {
    this.state = {
      elapsed: 0,
      lapStart: 0,
      lapNumber: 7,
      lapDist: 0,
      trackLength: 13600,
      bestLap: 222.456,
      lastLap: 223.891,
      bestS1: 41.123,
      bestS2: 82.456,
      sector: 1,
      sector1Time: 0,
      sector2Time: 0,
      fuel: 42.5,
      fuelCapacity: 90,
      maxLaps: 50,
      sessionTimeRemaining: 7200,
      seed: 42,
    };
    this._last = Date.now();
  }

  _rand() {
    this.state.seed = (this.state.seed * 16807 + 0) % 2147483647;
    return (this.state.seed & 0xfffffff) / 2147483647;
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

    this.state.lapDist += speedMs * dt;
    if (this.state.lapDist >= this.state.trackLength) {
      this.state.lapNumber += 1;
      this.state.lastLap = 220 + this._rand() * 6;
      if (this.state.lastLap < this.state.bestLap) this.state.bestLap = this.state.lastLap;
      this.state.lapStart = this.state.elapsed;
      this.state.lapDist = 0;
      this.state.sector = 1;
      this.state.sector1Time = 0;
      this.state.sector2Time = 0;
      this.state.fuel = Math.max(0, this.state.fuel - (2.0 + this._rand() * 0.3));
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

    return {
      playerHasVehicle: true,
      scoringInfo: {
        track: "Circuit de la Sarthe",
        session: 10,
        inRealtime: true,
        ambientTemp: 18.5,
        trackTemp: 28,
        maxLaps: s.maxLaps,
        sessionTimeRemaining: Math.max(0, s.sessionTimeRemaining - s.elapsed * 0.02),
        endET: s.elapsed + s.sessionTimeRemaining,
        currentET: s.elapsed,
        playerName: "Joevin SIRACH",
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
        bestLapTime: s.bestLap,
        lastLapTime: s.lastLap,
        bestSector1: s.bestS1,
        bestSector2: s.bestS2,
        curSector1: s.sector1Time || (s.sector >= 1 ? lapTime : 0),
        curSector2: s.sector2Time || (s.sector === 0 ? lapTime : 0),
        place: 4,
        timeBehindLeader: 12.456,
        lapsBehindLeader: 0,
      },
    };
  }
}

module.exports = { MockTelemetrySource };
