import { describe, expect, it } from 'vitest';
import { createStationsLayer } from '../../src/components/map/layers/StationsLayer';
import {
  AMBIENT_NOISE_MAX_INTENSITY,
  generateAmbientNoiseLevels,
  populationDensityToAmbientIntensity
} from '../../src/core/utils/colorUtils';
import { StationState, type StationDataBuffer } from '../../src/core/types';

describe('ambient station noise colors', () => {
  it('maps population density to the blue-to-green ambient intensity range', () => {
    expect(populationDensityToAmbientIntensity(0)).toBe(-3);
    expect(populationDensityToAmbientIntensity(458.67)).toBeGreaterThan(-2);
    expect(populationDensityToAmbientIntensity(1408.89)).toBeGreaterThan(-2);
    expect(populationDensityToAmbientIntensity(5000)).toBeGreaterThan(-2);
    expect(populationDensityToAmbientIntensity(5000)).toBeLessThan(AMBIENT_NOISE_MAX_INTENSITY);
    expect(populationDensityToAmbientIntensity(26664)).toBe(AMBIENT_NOISE_MAX_INTENSITY);
  });

  it('generates a new ambient noise sample for every station on each update', () => {
    const densities = new Float32Array([0, 458.67, 1408.89, 26664]);
    let firstSampleCount = 0;
    const firstSample = generateAmbientNoiseLevels(densities, () => {
      firstSampleCount++;
      return 0.1;
    });
    const secondSample = generateAmbientNoiseLevels(densities, () => 0.9);

    expect(firstSampleCount).toBe(densities.length);
    expect(secondSample).toHaveLength(densities.length);
    expect(Array.from(secondSample)).not.toEqual(Array.from(firstSample));
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
});
