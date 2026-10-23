import { describe, expect, it } from 'vitest';
import {
  calculateLPGMFromWaveform,
  calculateLPGMResponseSpectrum,
  classifyLPGM,
  estimateLPGM
} from '../../src/core/physics/lpgm';
import { EarthquakeHypocenter } from '../../src/core/types';

describe('LPGM response spectrum', () => {
  it('calculates the 5%-damped absolute velocity response from 1.6 to 7.8 seconds', () => {
    const dt = 0.05;
    const acceleration = Float64Array.from(
      { length: 1201 },
      (_, index) => 100 * Math.sin(2 * Math.PI * index * dt / 3)
    );

    const spectrum = calculateLPGMResponseSpectrum(acceleration, dt);

    expect(spectrum).toHaveLength(32);
    expect(spectrum[0].periodSec).toBe(1.6);
    expect(spectrum.at(-1)?.periodSec).toBe(7.8);
    expect(spectrum.every((point) => point.absoluteVelocityResponse > 0)).toBe(true);
  });

  it('scales the spectrum linearly with the input waveform amplitude', () => {
    const waveform = Float64Array.from(
      { length: 801 },
      (_, index) => 40 * Math.sin(2 * Math.PI * index * 0.05 / 4)
    );
    const doubledWaveform = waveform.map((sample) => sample * 2);

    const base = calculateLPGMFromWaveform(waveform, 0.05);
    const doubled = calculateLPGMFromWaveform(doubledWaveform, 0.05);

    expect(doubled.sv).toBeCloseTo(base.sv * 2, 8);
  });

  it.each([
    [0, 0],
    [4.99, 0],
    [5, 1],
    [14.99, 1],
    [15, 2],
    [49.99, 2],
    [50, 3],
    [99.99, 3],
    [100, 4]
  ])('classifies Sva %s cm/s as class %s', (sv, expectedClass) => {
    expect(classifyLPGM(sv)).toBe(expectedClass);
  });

  it('returns no response for a zero waveform and rejects invalid input', () => {
    expect(calculateLPGMFromWaveform(new Float64Array(16), 0.05)).toEqual({
      sv: 0,
      classLevel: 0
    });
    expect(() => calculateLPGMResponseSpectrum([0, Number.NaN], 0.05)).toThrow(
      'Invalid ground acceleration sample at index 1.'
    );
    expect(() => calculateLPGMResponseSpectrum([0, 1], 0)).toThrow(
      'Invalid sampling interval dt'
    );
  });

  it('estimates a finite response using the simulator waveform model', () => {
    const hypocenter: EarthquakeHypocenter = {
      lat: 35.5,
      lon: 139.5,
      depth: 20,
      magnitude: 7,
      originTime: 0
    };

    const result = estimateLPGM(hypocenter, 35.7, 139.7);

    expect(Number.isFinite(result.sv)).toBe(true);
    expect(result.sv).toBeGreaterThan(0);
    expect(result.classLevel).toBeGreaterThan(0);
  });
});
