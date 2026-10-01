/**
 * src/core/types.ts
 * =================
 * Data contracts, type definitions, state enums, and messaging interfaces for Phase 2.
 */
export var StationState;
(function (StationState) {
    StationState[StationState["IDLE"] = 0] = "IDLE";
    StationState[StationState["P_TRIGGERED"] = 1] = "P_TRIGGERED";
    StationState[StationState["S_ARRIVED"] = 2] = "S_ARRIVED";
})(StationState || (StationState = {}));
