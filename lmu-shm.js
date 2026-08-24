"use strict";

const fs = require("fs");
const path = require("path");
const { decodeBytes } = require("./lmu-normalize");

const OFFSETS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "lmu-offsets.json"), "utf8")
);

function readCString(buf, off, len) {
  return decodeBytes(buf.subarray(off, off + len));
}

function parseSnapshot(buf) {
  const O = OFFSETS;
  const scBase = O.scoringInfo.base;
  const teBase = O.telemetry.base;
  const gameVersion = buf.readInt32LE(O.generic.gameVersion);

  const activeVehicles = buf.readUInt8(teBase + O.telemetry.activeVehicles);
  const playerIdx = buf.readUInt8(teBase + O.telemetry.playerVehicleIdx);
  const playerHasVehicle = buf.readUInt8(teBase + O.telemetry.playerHasVehicle) !== 0;

  const scoringInfo = {
    track: readCString(buf, scBase + O.scoringInfo.trackName, 64),
    session: buf.readInt32LE(scBase + O.scoringInfo.session),
    currentET: buf.readDoubleLE(scBase + O.scoringInfo.currentET),
    endET: buf.readDoubleLE(scBase + O.scoringInfo.endET),
    maxLaps: buf.readInt32LE(scBase + O.scoringInfo.maxLaps),
    inRealtime: buf.readUInt8(scBase + O.scoringInfo.inRealtime) !== 0,
    playerName: readCString(buf, scBase + O.scoringInfo.playerName, 32),
    ambientTemp: buf.readDoubleLE(scBase + O.scoringInfo.ambientTemp),
    trackTemp: buf.readDoubleLE(scBase + O.scoringInfo.trackTemp),
    sessionTimeRemaining: buf.readFloatLE(scBase + O.scoringInfo.sessionTimeRemaining),
  };

  if (!playerHasVehicle || playerIdx >= activeVehicles) {
    return { gameVersion, playerHasVehicle: false, scoringInfo };
  }

  const vehBase = teBase + O.telemetry.telemInfo + playerIdx * O.telemetry.stride;
  const scoreBase = O.vehScoring.base + playerIdx * O.vehScoring.stride;

  const wheels = [];
  const wheelsBase = vehBase + O.telemetry.wheels;
  for (let i = 0; i < 4; i++) {
    const wOff = wheelsBase + i * O.wheel.stride;
    wheels.push({
      temperature: [
        buf.readDoubleLE(wOff + O.wheel.temperature),
        buf.readDoubleLE(wOff + O.wheel.temperature + 8),
        buf.readDoubleLE(wOff + O.wheel.temperature + 16),
      ],
      pressure: buf.readDoubleLE(wOff + O.wheel.pressure),
      wear: buf.readDoubleLE(wOff + O.wheel.wear),
      brakeTemp: buf.readDoubleLE(wOff + O.wheel.brakeTemp),
      compoundType: buf.readUInt8(wOff + O.wheel.compoundType),
    });
  }

  const telem = {
    vehicleName: readCString(buf, vehBase + O.telemetry.vehicleName, 64),
    vehicleModel: readCString(buf, vehBase + O.telemetry.vehicleModel, 30),
    track: readCString(buf, vehBase + O.telemetry.trackName, 64),
    lapNumber: buf.readInt32LE(vehBase + O.telemetry.lapNumber),
    lapStartET: buf.readDoubleLE(vehBase + O.telemetry.lapStartET),
    elapsedTime: buf.readDoubleLE(vehBase + O.telemetry.elapsedTime),
    gear: buf.readInt32LE(vehBase + O.telemetry.gear),
    maxGears: buf.readUInt8(vehBase + O.telemetry.maxGears),
    engineRPM: buf.readDoubleLE(vehBase + O.telemetry.engineRPM),
    engineMaxRPM: buf.readDoubleLE(vehBase + O.telemetry.engineMaxRPM),
    localVelX: buf.readDoubleLE(vehBase + O.telemetry.localVelX),
    localVelZ: buf.readDoubleLE(vehBase + O.telemetry.localVelZ),
    filteredThrottle: buf.readDoubleLE(vehBase + O.telemetry.filteredThrottle),
    filteredBrake: buf.readDoubleLE(vehBase + O.telemetry.filteredBrake),
    filteredSteering: buf.readDoubleLE(vehBase + O.telemetry.filteredSteering),
    filteredClutch: buf.readDoubleLE(vehBase + O.telemetry.filteredClutch),
    fuel: buf.readDoubleLE(vehBase + O.telemetry.fuel),
    fuelCapacity: buf.readDoubleLE(vehBase + O.telemetry.fuelCapacity),
    frontCompoundName: readCString(buf, vehBase + O.telemetry.frontCompoundName, 18),
    rearCompoundName: readCString(buf, vehBase + O.telemetry.rearCompoundName, 18),
    timeGapPlaceAhead: buf.readFloatLE(vehBase + O.telemetry.timeGapPlaceAhead),
    timeGapPlaceBehind: buf.readFloatLE(vehBase + O.telemetry.timeGapPlaceBehind),
    wheels,
  };

  const score = {
    driverName: readCString(buf, scoreBase + O.vehScoring.driverName, 32),
    sector: buf.readInt8(scoreBase + O.vehScoring.sector),
    bestLapTime: buf.readDoubleLE(scoreBase + O.vehScoring.bestLapTime),
    lastLapTime: buf.readDoubleLE(scoreBase + O.vehScoring.lastLapTime),
    bestSector1: buf.readDoubleLE(scoreBase + O.vehScoring.bestSector1),
    bestSector2: buf.readDoubleLE(scoreBase + O.vehScoring.bestSector2),
    curSector1: buf.readDoubleLE(scoreBase + O.vehScoring.curSector1),
    curSector2: buf.readDoubleLE(scoreBase + O.vehScoring.curSector2),
    place: buf.readUInt8(scoreBase + O.vehScoring.place),
    timeBehindLeader: buf.readDoubleLE(scoreBase + O.vehScoring.timeBehindLeader),
    lapsBehindLeader: buf.readInt32LE(scoreBase + O.vehScoring.lapsBehindLeader),
  };

  return { gameVersion, playerHasVehicle: true, scoringInfo, telem, score };
}

class WindowsSharedMemoryReader {
  constructor() {
    this._koffi = null;
    this._kernel32 = null;
    this._view = null;
    this._buffer = null;
    this._handle = null;
    this._size = OFFSETS.LMU_OBJECT_OUT_SIZE;
    this._FILE_MAP_READ = 0x0004;
    this._INVALID = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  }

  _loadKoffi() {
    if (this._koffi) return true;
    if (process.platform !== "win32") return false;
    try {
      this._koffi = require("koffi");
      this._kernel32 = this._koffi.load("kernel32.dll");
      this._OpenFileMappingW = this._kernel32.func(
        "void* OpenFileMappingW(uint32 dwDesiredAccess, int bInheritHandle, str lpName)"
      );
      this._MapViewOfFile = this._kernel32.func(
        "void* MapViewOfFile(void* hFileMappingObject, uint32 dwDesiredAccess, uint32 dwFileOffsetHigh, uint32 dwFileOffsetLow, size_t dwNumberOfBytesToMap)"
      );
      this._UnmapViewOfFile = this._kernel32.func("int UnmapViewOfFile(void* lpBaseAddress)");
      this._CloseHandle = this._kernel32.func("int CloseHandle(void* hObject)");
      return true;
    } catch (_) {
      return false;
    }
  }

  connect() {
    if (!this._loadKoffi()) return false;
    if (this._handle) return true;
    try {
      const h = this._OpenFileMappingW(this._FILE_MAP_READ, 0, "LMU_Data");
      if (!h || Buffer.compare(Buffer.from(new BigUint64Array([BigInt(h)]).buffer), this._INVALID) === 0) {
        return false;
      }
      const view = this._MapViewOfFile(h, this._FILE_MAP_READ, 0, 0, this._size);
      if (!view) {
        this._CloseHandle(h);
        return false;
      }
      this._handle = h;
      this._view = view;
      this._buffer = this._koffi.decode(view, "uint8", this._size);
      return true;
    } catch (_) {
      this.close();
      return false;
    }
  }

  close() {
    try {
      if (this._view && this._UnmapViewOfFile) this._UnmapViewOfFile(this._view);
      if (this._handle && this._CloseHandle) this._CloseHandle(this._handle);
    } catch (_) {}
    this._view = null;
    this._handle = null;
    this._buffer = null;
  }

  readBuffer() {
    if (!this.connect()) return null;
    try {
      this._buffer = this._koffi.decode(this._view, "uint8", this._size);
      return Buffer.from(this._buffer);
    } catch (_) {
      this.close();
      return null;
    }
  }
}

module.exports = { parseSnapshot, WindowsSharedMemoryReader, OFFSETS };
