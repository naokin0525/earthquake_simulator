/**
 * src/components/map/layers/StationsLayer.ts
 * ===========================================
 * Deck.gl ScatterplotLayer rendering 1,749 seismograph stations across Japan
 * with dynamic JMA intensity color coding and state pulse effects.
 */

import { ScatterplotLayer } from '@deck.gl/layers';
import { StationDataBuffer, StationState, JmaIntensityScale, StationTriggerEvent } from '../../../core/types';
import { jmaScaleToNumeric } from '../../../core/physics/attenuation';

export interface StationLayerProps {
  id?: string;
  stationBuffer: StationDataBuffer;
  stationStates: Uint8Array;
  triggerEventsMap?: Map<number, StationTriggerEvent>;
  kyoshinMonitor?: boolean;
  mapVersion?: number;
  onHover?: (info: any) => void;
}

const KYOSHIN_GRADIENT: { Intensity: number; R: number; G: number; B: number }[] = [
  { Intensity: -3, R: 0, G: 0, B: 205 },
  { Intensity: -2.9, R: 0, G: 7, B: 209 },
  { Intensity: -2.8, R: 0, G: 14, B: 214 },
  { Intensity: -2.7, R: 0, G: 21, B: 218 },
  { Intensity: -2.6, R: 0, G: 28, B: 223 },
  { Intensity: -2.5, R: 0, G: 36, B: 227 },
  { Intensity: -2.4, R: 0, G: 43, B: 231 },
  { Intensity: -2.3, R: 0, G: 50, B: 236 },
  { Intensity: -2.2, R: 0, G: 57, B: 240 },
  { Intensity: -2.1, R: 0, G: 64, B: 245 },
  { Intensity: -2, R: 0, G: 72, B: 250 },
  { Intensity: -1.9, R: 0, G: 85, B: 238 },
  { Intensity: -1.8, R: 0, G: 99, B: 227 },
  { Intensity: -1.7, R: 0, G: 112, B: 216 },
  { Intensity: -1.6, R: 0, G: 126, B: 205 },
  { Intensity: -1.5, R: 0, G: 140, B: 194 },
  { Intensity: -1.4, R: 0, G: 153, B: 183 },
  { Intensity: -1.3, R: 0, G: 167, B: 172 },
  { Intensity: -1.2, R: 0, G: 180, B: 161 },
  { Intensity: -1.1, R: 0, G: 194, B: 150 },
  { Intensity: -1, R: 0, G: 208, B: 139 },
  { Intensity: -0.9, R: 6, G: 212, B: 130 },
  { Intensity: -0.8, R: 12, G: 216, B: 121 },
  { Intensity: -0.7, R: 18, G: 220, B: 113 },
  { Intensity: -0.6, R: 25, G: 224, B: 104 },
  { Intensity: -0.5, R: 31, G: 228, B: 96 },
  { Intensity: -0.4, R: 37, G: 233, B: 88 },
  { Intensity: -0.3, R: 44, G: 237, B: 79 },
  { Intensity: -0.2, R: 50, G: 241, B: 71 },
  { Intensity: -0.1, R: 56, G: 245, B: 62 },
  { Intensity: 0, R: 63, G: 250, B: 54 },
  { Intensity: 0.1, R: 75, G: 250, B: 49 },
  { Intensity: 0.2, R: 88, G: 250, B: 45 },
  { Intensity: 0.3, R: 100, G: 251, B: 41 },
  { Intensity: 0.4, R: 113, G: 251, B: 37 },
  { Intensity: 0.5, R: 125, G: 252, B: 33 },
  { Intensity: 0.6, R: 138, G: 252, B: 28 },
  { Intensity: 0.7, R: 151, G: 253, B: 24 },
  { Intensity: 0.8, R: 163, G: 253, B: 20 },
  { Intensity: 0.9, R: 176, G: 254, B: 16 },
  { Intensity: 1, R: 189, G: 255, B: 12 },
  { Intensity: 1.1, R: 195, G: 254, B: 10 },
  { Intensity: 1.2, R: 202, G: 254, B: 9 },
  { Intensity: 1.3, R: 208, G: 254, B: 8 },
  { Intensity: 1.4, R: 215, G: 254, B: 7 },
  { Intensity: 1.5, R: 222, G: 255, B: 5 },
  { Intensity: 1.6, R: 228, G: 254, B: 4 },
  { Intensity: 1.7, R: 235, G: 255, B: 3 },
  { Intensity: 1.8, R: 241, G: 254, B: 2 },
  { Intensity: 1.9, R: 248, G: 255, B: 1 },
  { Intensity: 2, R: 255, G: 255, B: 0 },
  { Intensity: 2.1, R: 254, G: 251, B: 0 },
  { Intensity: 2.2, R: 254, G: 248, B: 0 },
  { Intensity: 2.3, R: 254, G: 244, B: 0 },
  { Intensity: 2.4, R: 254, G: 241, B: 0 },
  { Intensity: 2.5, R: 255, G: 238, B: 0 },
  { Intensity: 2.6, R: 254, G: 234, B: 0 },
  { Intensity: 2.7, R: 255, G: 231, B: 0 },
  { Intensity: 2.8, R: 254, G: 227, B: 0 },
  { Intensity: 2.9, R: 255, G: 224, B: 0 },
  { Intensity: 3, R: 255, G: 221, B: 0 },
  { Intensity: 3.1, R: 254, G: 213, B: 0 },
  { Intensity: 3.2, R: 254, G: 205, B: 0 },
  { Intensity: 3.3, R: 254, G: 197, B: 0 },
  { Intensity: 3.4, R: 254, G: 190, B: 0 },
  { Intensity: 3.5, R: 255, G: 182, B: 0 },
  { Intensity: 3.6, R: 254, G: 174, B: 0 },
  { Intensity: 3.7, R: 255, G: 167, B: 0 },
  { Intensity: 3.8, R: 254, G: 159, B: 0 },
  { Intensity: 3.9, R: 255, G: 151, B: 0 },
  { Intensity: 4, R: 255, G: 144, B: 0 },
  { Intensity: 4.1, R: 254, G: 136, B: 0 },
  { Intensity: 4.2, R: 254, G: 128, B: 0 },
  { Intensity: 4.3, R: 254, G: 121, B: 0 },
  { Intensity: 4.4, R: 254, G: 113, B: 0 },
  { Intensity: 4.5, R: 255, G: 106, B: 0 },
  { Intensity: 4.6, R: 254, G: 98, B: 0 },
  { Intensity: 4.7, R: 255, G: 90, B: 0 },
  { Intensity: 4.8, R: 254, G: 83, B: 0 },
  { Intensity: 4.9, R: 255, G: 75, B: 0 },
  { Intensity: 5, R: 255, G: 68, B: 0 },
  { Intensity: 5.1, R: 254, G: 61, B: 0 },
  { Intensity: 5.2, R: 253, G: 54, B: 0 },
  { Intensity: 5.3, R: 252, G: 47, B: 0 },
  { Intensity: 5.4, R: 251, G: 40, B: 0 },
  { Intensity: 5.5, R: 250, G: 33, B: 0 },
  { Intensity: 5.6, R: 249, G: 27, B: 0 },
  { Intensity: 5.7, R: 248, G: 20, B: 0 },
  { Intensity: 5.8, R: 247, G: 13, B: 0 },
  { Intensity: 5.9, R: 246, G: 6, B: 0 },
  { Intensity: 6, R: 245, G: 0, B: 0 },
  { Intensity: 6.1, R: 238, G: 0, B: 0 },
  { Intensity: 6.2, R: 230, G: 0, B: 0 },
  { Intensity: 6.3, R: 223, G: 0, B: 0 },
  { Intensity: 6.4, R: 215, G: 0, B: 0 },
  { Intensity: 6.5, R: 208, G: 0, B: 0 },
  { Intensity: 6.6, R: 200, G: 0, B: 0 },
  { Intensity: 6.7, R: 192, G: 0, B: 0 },
  { Intensity: 6.8, R: 185, G: 0, B: 0 },
  { Intensity: 6.9, R: 177, G: 0, B: 0 },
  { Intensity: 7, R: 170, G: 0, B: 0 },
  { Intensity: 8, R: 0, G: 0, B: 0 }
];

const JMA_COLOR_MAP: Record<number, [number, number, number, number]> = {
  1: [75, 150, 214, 240],  // '1'
  2: [16, 78, 158, 240],   // '2'
  3: [30, 130, 76, 240],    // '3'
  4: [241, 196, 15, 255],   // '4'
  5: [243, 156, 18, 255],   // '5-'
  6: [230, 126, 34, 255],   // '5+'
  7: [231, 76, 60, 255],    // '6-'
  8: [192, 57, 43, 255],    // '6+'
  9: [142, 68, 173, 255]    // '7'
};
function getKyoshinColor(val: number): [number, number, number, 255] {
  const min = KYOSHIN_GRADIENT[0].Intensity;
  const max = KYOSHIN_GRADIENT[KYOSHIN_GRADIENT.length - 1].Intensity;
  if (val <= min) {
    const { R, G, B } = KYOSHIN_GRADIENT[0];
    return [R, G, B, 255];
  }
  if (val >= max) {
    const { R, G, B } = KYOSHIN_GRADIENT[KYOSHIN_GRADIENT.length - 1];
    return [R, G, B, 255];
  }
  for (let i = 0; i < KYOSHIN_GRADIENT.length - 1; i++) {
    const a = KYOSHIN_GRADIENT[i];
    const b = KYOSHIN_GRADIENT[i + 1];
    if (val >= a.Intensity && val <= b.Intensity) {
      const t = (val - a.Intensity) / (b.Intensity - a.Intensity);
      const r = Math.round(a.R + t * (b.R - a.R));
      const g = Math.round(a.G + t * (b.G - a.G));
      const bcol = Math.round(a.B + t * (b.B - a.B));
      return [r, g, bcol, 255];
    }
  }
  const { R, G, B } = KYOSHIN_GRADIENT[0];
  return [R, G, B, 255];
}

export function createStationsLayer(props: StationLayerProps): ScatterplotLayer {
  const { stationBuffer, stationStates, triggerEventsMap, onHover, kyoshinMonitor, mapVersion, id = 'stations-layer' } = props;

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
        // Determine intensity value (instrumental)
        let intensityVal = -3; // Default minimum intensity
        const ev = triggerEventsMap?.get(d);
        if (ev) {
          // Use continuousIntensity if available; fallback to -3
          intensityVal = ev.continuousIntensity ?? -3;
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
        return JMA_COLOR_MAP[num] ?? [230, 126, 34, 255];
      }
      return [230, 126, 34, 255];
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
        return 3.5; // uniform size for all stations
      }
      const state = stationStates[d] ?? StationState.IDLE;
      if (state === StationState.IDLE) return 1.5;
      if (state === StationState.P_TRIGGERED) {
        // Pulsing radius between 3 and 6
        return 4.5 + 1.5 * Math.sin(Date.now() / 150.0);
      }
      return 3.0; // S_ARRIVED
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
      getFillColor: [stationStates, triggerEventsMap, kyoshinMonitor, mapVersion, Date.now()],
      getLineColor: [stationStates, kyoshinMonitor],
      getRadius: [stationStates, kyoshinMonitor, Date.now()],
      getLineWidth: [stationStates]
    }
  });
}
