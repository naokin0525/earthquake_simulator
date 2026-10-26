/**
 * src/components/map/layers/StationsLayer.ts
 * ===========================================
 * Deck.gl ScatterplotLayer rendering 1,749 seismograph stations across Japan
 * with dynamic JMA intensity color coding and state pulse effects.
 */

import { ScatterplotLayer } from '@deck.gl/layers';
import { StationDataBuffer, StationState, JmaIntensityScale, StationTriggerEvent } from '../../../core/types';
import { jmaScaleToNumeric } from '../../../core/physics/attenuation';
import { getKyoshinColor, populationDensityToAmbientIntensity } from '../../../core/utils/colorUtils';
import { hexToRgba, JMA_INTENSITY_LEVELS } from '../../../core/ui/intensityColors';

export interface StationLayerProps {
  id?: string;
  stationBuffer: StationDataBuffer;
  stationStates: Uint8Array;
  triggerEventsMap?: Map<number, StationTriggerEvent>;
  kyoshinMonitor?: boolean;
  mapVersion?: number;
  ambientNoiseLevels?: Float32Array | null;
  onHover?: (info: any) => void;
}

const JMA_COLOR_MAP = JMA_INTENSITY_LEVELS.map(({ colour }) => hexToRgba(colour));
const FALLBACK_INTENSITY_COLOR = JMA_COLOR_MAP[jmaScaleToNumeric('5+')];

export function createStationsLayer(props: StationLayerProps): ScatterplotLayer {
  const {
    stationBuffer,
    stationStates,
    triggerEventsMap,
    onHover,
    kyoshinMonitor,
    mapVersion,
    ambientNoiseLevels,
    id = 'stations-layer'
  } = props;

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
    getPosition: (d: number) => [stationBuffer.lons[d], stationBuffer.lats[d]],
    getFillColor: (d: number) => {
      const state = stationStates[d] ?? StationState.IDLE;
      if (kyoshinMonitor) {
        // Prefer waveform-derived instrumental intensity; fall back to the modeled estimate.
        let intensityVal = -3; // Default minimum intensity
        const ev = triggerEventsMap?.get(d);
        if (ev) {
          intensityVal = ev.instrumentalIntensity ?? ev.continuousIntensity ?? -3;
        } else if (ambientNoiseLevels) {
          intensityVal = ambientNoiseLevels[d] ?? -3;
        } else if (stationBuffer.dailyNoise) {
          intensityVal = populationDensityToAmbientIntensity(stationBuffer.dailyNoise[d]);
        }
        return getKyoshinColor(intensityVal);
      }
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
        return JMA_COLOR_MAP[num] ?? FALLBACK_INTENSITY_COLOR;
      }
      return FALLBACK_INTENSITY_COLOR;
    },
    getLineColor: (d: number) => {
      if (kyoshinMonitor) {
        return [0, 0, 0, 0];
      }
      const state = stationStates[d] ?? StationState.IDLE;
      if (state === StationState.IDLE) return [0, 0, 0, 0]; // No border for idle
      if (state === StationState.P_TRIGGERED) return [255, 255, 255, 255]; // White border
      return [255, 255, 255, 200]; // Subtle border for S-wave
    },
    getRadius: (d: number) => {
      if (kyoshinMonitor) {
        return 3; // uniform size for all stations
      }
      const state = stationStates[d] ?? StationState.IDLE;
      if (state === StationState.IDLE) return 3;
      if (state === StationState.P_TRIGGERED) {
        return 6;
      }
      return 6; // S_ARRIVED
    },
    getLineWidth: (d: number) => {
      const state = stationStates[d] ?? StationState.IDLE;
      return state === StationState.IDLE ? 0 : 1;
    },
    stroked: true,
    filled: true,
    pickable: true,
    onHover,
    updateTriggers: {
      getFillColor: [stationStates, triggerEventsMap, kyoshinMonitor, mapVersion, ambientNoiseLevels],
      getLineColor: [stationStates, kyoshinMonitor],
      getRadius: [stationStates, kyoshinMonitor, Date.now()],
      getLineWidth: [stationStates]
    }
  });
}
