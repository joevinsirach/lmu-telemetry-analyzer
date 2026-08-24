"use strict";

const { normalizeTelemetry } = require("./lmu-normalize");
const { MockTelemetrySource } = require("./lmu-mock");
const { parseSnapshot, WindowsSharedMemoryReader } = require("./lmu-shm");

const MODES = { auto: "auto", mock: "mock", shm: "shm" };

class LiveTelemetryService {
  constructor(options = {}) {
    this.mode = options.mode || MODES.auto;
    this.mock = new MockTelemetrySource();
    this.reader = process.platform === "win32" ? new WindowsSharedMemoryReader() : null;
    this.lastPayload = null;
    this._forceMock = this.mode === MODES.mock;
  }

  setMode(mode) {
    if (mode === MODES.mock) this._forceMock = true;
    else if (mode === MODES.shm) this._forceMock = false;
    this.mode = mode;
  }

  snapshot() {
    if (this._forceMock || this.mode === MODES.mock) {
      this.lastPayload = this.mock.snapshot();
      return this.lastPayload;
    }

    if (process.platform !== "win32") {
      this.lastPayload = this.mock.snapshot();
      this.lastPayload.connection.state = "mock";
      this.lastPayload.connection.message = "Shared memory requires Windows — demo mode";
      this.lastPayload.source = "mock";
      return this.lastPayload;
    }

    const buf = this.reader && this.reader.readBuffer();
    if (!buf) {
      if (this.mode === MODES.auto) {
        this.lastPayload = this.mock.snapshot();
        this.lastPayload.connection.state = "waiting";
        this.lastPayload.connection.message = "Waiting for LMU (LMU_Data not found) — demo mode";
        return this.lastPayload;
      }
      return normalizeTelemetry({
        source: "lmu",
        state: "waiting",
        raw: null,
        message: "Waiting for LMU (LMU_Data mapping not found)",
      });
    }

    const raw = parseSnapshot(buf);
    const version = raw.gameVersion | 0;
    if (version <= 0) {
      return normalizeTelemetry({
        source: "lmu",
        state: "waiting",
        raw,
        gameVersion: version,
        message: "LMU detected but no active session",
      });
    }

    this.lastPayload = normalizeTelemetry({
      source: "lmu",
      state: "connected",
      raw,
      gameVersion: version,
      message: "Connected",
    });
    return this.lastPayload;
  }
}

module.exports = { LiveTelemetryService, MODES };
