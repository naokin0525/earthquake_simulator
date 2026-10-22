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
  { Intensity: -2, R: 0, G: 72, B: 250 },
  { Intensity: -1, R: 0, G: 208, B: 139 },
  { Intensity: 0, R: 63, G: 250, B: 54 },
  { Intensity: 1, R: 189, G: 255, B: 12 },
  { Intensity: 2, R: 255, G: 255, B: 0 },
  { Intensity: 3, R: 255, G: 221, B: 0 },
  { Intensity: 4, R: 255, G: 144, B: 0 },
  { Intensity: 5, R: 255, G: 68, B: 0 },
  { Intensity: 6, R: 245, G: 0, B: 0 },
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
