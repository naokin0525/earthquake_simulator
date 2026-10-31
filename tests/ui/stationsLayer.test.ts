import { describe, expect, it } from 'vitest';
import { createStationsLayer } from '../../src/components/map/layers/StationsLayer';
import {
  AMBIENT_NOISE_MIN_DENSITY,
  AMBIENT_NOISE_MAX_INTENSITY,
  generateAmbientNoiseLevels,
  getKyoshinColor,
  populationDensityToAmbientIntensity
} from '../../src/core/utils/colorUtils';
import { StationState, type StationDataBuffer } from '../../src/core/types';

describe('ambient station noise colors', () => {
  it('keeps station icons within readable pixel size limits', () => {
    const stationBuffer: StationDataBuffer = {
      totalStations: 1,
      lats: new Float32Array([35]),
      lons: new Float32Array([139]),
      ampFactors: new Float32Array([1]),
      prefCodes: new Uint8Array([13])
    };
    const layer = createStationsLayer({
      stationBuffer,
      stationStates: new Uint8Array([StationState.IDLE])
    });

    expect(layer.props.radiusMinPixels).toBe(2);
    expect(layer.props.radiusMaxPixels).toBe(8);
  });

  it('maps 25,000 people/km² to about -1.5 and suppresses low-density noise', () => {
    expect(populationDensityToAmbientIntensity(0)).toBe(-3);
    expect(populationDensityToAmbientIntensity(AMBIENT_NOISE_MIN_DENSITY - 1)).toBe(-3);
    expect(populationDensityToAmbientIntensity(25000)).toBeCloseTo(-1.5);
    expect(populationDensityToAmbientIntensity(26664)).toBe(AMBIENT_NOISE_MAX_INTENSITY);
  });

  it('generates a new ambient noise sample for every station on each update', () => {
    const densities = new Float32Array([0, 9999, 10000, 26664]);
    let firstSampleCount = 0;
    const firstSample = generateAmbientNoiseLevels(densities, () => {
      firstSampleCount++;
      return 0.1;
    });
    const secondSample = generateAmbientNoiseLevels(densities, () => 0.9);

    expect(firstSampleCount).toBe(2);
    expect(secondSample).toHaveLength(densities.length);
    expect(Array.from(secondSample)).not.toEqual(Array.from(firstSample));
    expect(Array.from(secondSample.slice(0, 2))).toEqual([-3, -3]);
  });

  it('colors idle Kyoshin stations from their latest ambient noise sample', () => {
    const stationBuffer: StationDataBuffer = {
      totalStations: 2,
      lats: new Float32Array([35, 36]),
      lons: new Float32Array([139, 140]),
      ampFactors: new Float32Array([1, 1]),
      prefCodes: new Uint8Array([13, 14]),
      dailyNoise: new Float32Array([0, 1500])
    };
    const layer = createStationsLayer({
      stationBuffer,
      stationStates: new Uint8Array([StationState.IDLE, StationState.IDLE]),
      kyoshinMonitor: true,
      ambientNoiseLevels: new Float32Array([-3, -1])
    });
    const getFillColor = layer.props.getFillColor;
    if (typeof getFillColor !== 'function') {
      throw new Error('Station layer fill color accessor was not created');
    }

    const getColor = (index: number) =>
      getFillColor(index, { index, data: [0, 1], target: [] });
    expect(getColor(0)).toEqual([0, 0, 205, 255]);
    expect(getColor(1)[1]).toBeGreaterThan(getColor(0)[1]);
  });

  it('returns to ambient noise after the earthquake coda fades below it', () => {
    const stationBuffer: StationDataBuffer = {
      totalStations: 1,
      lats: new Float32Array([35]),
      lons: new Float32Array([139]),
      ampFactors: new Float32Array([1]),
      prefCodes: new Uint8Array([13])
    };
    const layer = createStationsLayer({
      stationBuffer,
      stationStates: new Uint8Array([StationState.S_ARRIVED]),
      triggerEventsMap: new Map([[0, {
        stationIndex: 0,
        state: StationState.S_ARRIVED,
        triggerTime: 1,
        pArrivalTime: 1,
        sArrivalTime: 2,
        pgvSurface: 0.001,
        intensity: '0',
        continuousIntensity: -2
      }]]),
      kyoshinMonitor: true,
      ambientNoiseLevels: new Float32Array([-1.8])
    });
    const getFillColor = layer.props.getFillColor;
    if (typeof getFillColor !== 'function') {
      throw new Error('Station layer fill color accessor was not created');
    }

    expect(getFillColor(0, { index: 0, data: [0], target: [] })).toEqual(
      getKyoshinColor(-1.8)
    );
  });
});
