#!/usr/bin/env python3
"""Emit JSON offsets for LMU_Data parsing (run once during dev / CI)."""
from __future__ import annotations

import ctypes
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from py_layout.layout import (  # noqa: E402
    LMUObjectOut,
    LMUGeneric,
    LMUVect3,
    LMUVehicleScoring,
    LMUVehicleTelemetry,
    LMUWheel,
    LMUScoringInfo,
    LMUTelemetryData,
    LMUScoringData,
)


def off(cls, field: str) -> int:
    return getattr(cls, field).offset


payload = {
    "LMU_OBJECT_OUT_SIZE": ctypes.sizeof(LMUObjectOut),
    "MAX_MAPPED_VEHICLES": 104,
    "generic": {"gameVersion": off(LMUObjectOut, "generic") + off(LMUGeneric, "gameVersion")},
    "scoringInfo": {
        "base": off(LMUObjectOut, "scoring") + off(LMUScoringData, "scoringInfo"),
        "trackName": off(LMUScoringInfo, "mTrackName"),
        "session": off(LMUScoringInfo, "mSession"),
        "currentET": off(LMUScoringInfo, "mCurrentET"),
        "endET": off(LMUScoringInfo, "mEndET"),
        "maxLaps": off(LMUScoringInfo, "mMaxLaps"),
        "lapDist": off(LMUScoringInfo, "mLapDist"),
        "numVehicles": off(LMUScoringInfo, "mNumVehicles"),
        "inRealtime": off(LMUScoringInfo, "mInRealtime"),
        "playerName": off(LMUScoringInfo, "mPlayerName"),
        "ambientTemp": off(LMUScoringInfo, "mAmbientTemp"),
        "trackTemp": off(LMUScoringInfo, "mTrackTemp"),
        "sessionTimeRemaining": off(LMUScoringInfo, "mSessionTimeRemaining"),
        "yellowFlagState": off(LMUScoringInfo, "mYellowFlagState"),
    },
    "vehScoring": {
        "base": off(LMUObjectOut, "scoring") + off(LMUScoringData, "vehScoringInfo"),
        "stride": ctypes.sizeof(LMUVehicleScoring),
        "driverName": off(LMUVehicleScoring, "mDriverName"),
        "sector": off(LMUVehicleScoring, "mSector"),
        "lapDist": off(LMUVehicleScoring, "mLapDist"),
        "bestLapTime": off(LMUVehicleScoring, "mBestLapTime"),
        "lastLapTime": off(LMUVehicleScoring, "mLastLapTime"),
        "bestSector1": off(LMUVehicleScoring, "mBestSector1"),
        "bestSector2": off(LMUVehicleScoring, "mBestSector2"),
        "curSector1": off(LMUVehicleScoring, "mCurSector1"),
        "curSector2": off(LMUVehicleScoring, "mCurSector2"),
        "place": off(LMUVehicleScoring, "mPlace"),
        "timeBehindNext": off(LMUVehicleScoring, "mTimeBehindNext"),
        "timeBehindLeader": off(LMUVehicleScoring, "mTimeBehindLeader"),
        "lapsBehindLeader": off(LMUVehicleScoring, "mLapsBehindLeader"),
    },
    "telemetry": {
        "base": off(LMUObjectOut, "telemetry"),
        "activeVehicles": off(LMUTelemetryData, "activeVehicles"),
        "playerVehicleIdx": off(LMUTelemetryData, "playerVehicleIdx"),
        "playerHasVehicle": off(LMUTelemetryData, "playerHasVehicle"),
        "telemInfo": off(LMUTelemetryData, "telemInfo"),
        "stride": ctypes.sizeof(LMUVehicleTelemetry),
        "lapNumber": off(LMUVehicleTelemetry, "mLapNumber"),
        "lapStartET": off(LMUVehicleTelemetry, "mLapStartET"),
        "elapsedTime": off(LMUVehicleTelemetry, "mElapsedTime"),
        "vehicleName": off(LMUVehicleTelemetry, "mVehicleName"),
        "vehicleModel": off(LMUVehicleTelemetry, "mVehicleModel"),
        "maxGears": off(LMUVehicleTelemetry, "mMaxGears"),
        "trackName": off(LMUVehicleTelemetry, "mTrackName"),
        "localVelX": off(LMUVehicleTelemetry, "mLocalVel") + off(LMUVect3, "x"),
        "localVelZ": off(LMUVehicleTelemetry, "mLocalVel") + 16,
        "gear": off(LMUVehicleTelemetry, "mGear"),
        "engineRPM": off(LMUVehicleTelemetry, "mEngineRPM"),
        "engineMaxRPM": off(LMUVehicleTelemetry, "mEngineMaxRPM"),
        "filteredThrottle": off(LMUVehicleTelemetry, "mFilteredThrottle"),
        "filteredBrake": off(LMUVehicleTelemetry, "mFilteredBrake"),
        "filteredSteering": off(LMUVehicleTelemetry, "mFilteredSteering"),
        "filteredClutch": off(LMUVehicleTelemetry, "mFilteredClutch"),
        "fuel": off(LMUVehicleTelemetry, "mFuel"),
        "fuelCapacity": off(LMUVehicleTelemetry, "mFuelCapacity"),
        "frontCompoundName": off(LMUVehicleTelemetry, "mFrontTireCompoundName"),
        "rearCompoundName": off(LMUVehicleTelemetry, "mRearTireCompoundName"),
        "timeGapPlaceAhead": off(LMUVehicleTelemetry, "mTimeGapPlaceAhead"),
        "timeGapPlaceBehind": off(LMUVehicleTelemetry, "mTimeGapPlaceBehind"),
        "wheels": off(LMUVehicleTelemetry, "mWheels"),
    },
    "wheel": {
        "stride": ctypes.sizeof(LMUWheel),
        "temperature": off(LMUWheel, "mTemperature"),
        "pressure": off(LMUWheel, "mPressure"),
        "wear": off(LMUWheel, "mWear"),
        "brakeTemp": off(LMUWheel, "mBrakeTemp"),
        "compoundType": off(LMUWheel, "mCompoundType"),
    },
    "events": {
        "base": off(LMUObjectOut, "generic") + off(LMUGeneric, "events"),
        "updateScoring": 10 * 4,
        "updateTelemetry": 11 * 4,
    },
}

out = ROOT / "lmu-offsets.json"
out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
print(f"Wrote {out} ({payload['LMU_OBJECT_OUT_SIZE']} bytes)")
