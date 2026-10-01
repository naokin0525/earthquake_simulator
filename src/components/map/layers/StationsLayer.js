/**
 * src/components/map/layers/StationsLayer.ts
 * ===========================================
 * Deck.gl ScatterplotLayer rendering 1,749 seismograph stations across Japan
 * with dynamic JMA intensity color coding and state pulse effects.
 */
import { ScatterplotLayer } from '@deck.gl/layers';
import { StationState } from '../../../core/types';
import { jmaScaleToNumeric } from '../../../core/physics/attenuation';
const JMA_COLOR_MAP = {
    0: [160, 160, 160, 240], // '0'
    1: [75, 150, 214, 240], // '1'
    2: [16, 78, 158, 240], // '2'
    3: [30, 130, 76, 240], // '3'
    4: [241, 196, 15, 255], // '4'
    5: [243, 156, 18, 255], // '5-'
    6: [230, 126, 34, 255], // '5+'
    7: [231, 76, 60, 255], // '6-'
    8: [192, 57, 43, 255], // '6+'
    9: [142, 68, 173, 255] // '7'
};
export function createStationsLayer(props) {
    const { stationBuffer, stationStates, triggerEventsMap, onHover, id = 'stations-layer' } = props;
    // Build station data items
    const data = new Array(stationBuffer.totalStations);
    for (let i = 0; i < stationBuffer.totalStations; i++) {
        data[i] = i;
    }
    return new ScatterplotLayer({
        id,
        data,
        radiusUnits: 'pixels',
        lineWidthUnits: 'pixels',
        getPosition: (d) => [stationBuffer.lons[d], stationBuffer.lats[d]],
        getFillColor: (d) => {
            const state = stationStates[d] ?? StationState.IDLE;
            if (state === StationState.IDLE) {
                return [120, 120, 120, 100]; // Subtle gray
            }
            if (state === StationState.P_TRIGGERED) {
                return [0, 0, 0, 0]; // Transparent inside for P-wave
            }
            // S_ARRIVED
            const ev = triggerEventsMap?.get(d);
            if (ev) {
                const num = jmaScaleToNumeric(ev.intensity);
                return JMA_COLOR_MAP[num] ?? [230, 126, 34, 255];
            }
            return [230, 126, 34, 255];
        },
        getLineColor: (d) => {
            const state = stationStates[d] ?? StationState.IDLE;
            if (state === StationState.IDLE)
                return [0, 0, 0, 0]; // No border for idle
            if (state === StationState.P_TRIGGERED)
                return [255, 255, 255, 255]; // White border
            return [255, 255, 255, 200]; // Subtle border for S-wave
        },
        getRadius: (d) => {
            const state = stationStates[d] ?? StationState.IDLE;
            if (state === StationState.IDLE)
                return 1.5;
            if (state === StationState.P_TRIGGERED) {
                // Pulsing radius between 3 and 6
                return 4.5 + 1.5 * Math.sin(Date.now() / 150.0);
            }
            return 3.0; // S_ARRIVED
        },
        getLineWidth: (d) => {
            const state = stationStates[d] ?? StationState.IDLE;
            return state === StationState.IDLE ? 0 : 1;
        },
        stroked: true,
        filled: true,
        pickable: true,
        onHover,
        updateTriggers: {
            getFillColor: [stationStates, triggerEventsMap],
            getLineColor: [stationStates],
            getRadius: [stationStates, Date.now()],
            getLineWidth: [stationStates]
        }
    });
}
