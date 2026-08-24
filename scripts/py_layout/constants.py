"""Constants for the official LMU shared memory interface."""


class LMUConstants:
    """Values from LMU Support/SharedMemoryInterface headers (S397)."""

    LMU_SHARED_MEMORY_FILE = "LMU_Data"
    LMU_PROCESS_NAME = "Le Mans Ultimate"
    MAX_MAPPED_VEHICLES = 104
    MAX_PATH_LENGTH = 260

    RF2_TELEMETRY_FILE = "$rFactor2SMMP_Telemetry$"
    RF2_SCORING_FILE = "$rFactor2SMMP_Scoring$"
    RF2_EXTENDED_FILE = "$rFactor2SMMP_Extended$"
