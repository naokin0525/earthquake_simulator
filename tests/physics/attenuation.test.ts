/**
 * tests/physics/attenuation.test.ts
 * =================================
 * Unit tests validating Si & Midorikawa (1999) PGV formula and JMA intensity quantization.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateBedrockPgv,
  calculateMorikawaCorrectionTerms,
  calculateTrenchAxisDistanceKm,
  PACIFIC_TRENCH_AXIS_POINTS,
  calculateSurfacePgv,
  calculateContinuousJmaIntensity,
  quantizeJmaIntensity,
  calculateJmaIntensity
} from '../../src/core/physics/attenuation';

describe('Si & Midorikawa (1999) PGV & JMA Intensity Engine', () => {
  it('should compute valid bedrock PGV for 2011 Tohoku Mw 9.0 benchmark at 100km distance', () => {
    // 2011 Tohoku Mw 9.0, depth = 24km, R = 100km
    const bedrockPgv = calculateBedrockPgv(100.0, 24.0, 9.0, 0.0);
    expect(bedrockPgv).toBeGreaterThan(10.0); // > 10 cm/s
    expect(bedrockPgv).toBeLessThan(150.0);   // < 150 cm/s
  });

  it('should compute valid bedrock PGV for 2016 Kumamoto M 7.3 benchmark at near-field 20km distance', () => {
    // 2016 Kumamoto Mw 7.1 (Mj 7.3), depth = 12km, R = 20km
    const bedrockPgv = calculateBedrockPgv(20.0, 12.0, 7.1, 0.0);
    expect(bedrockPgv).toBeGreaterThan(15.0); // Bedrock PGV ~ 22.8 cm/s (Surface PGV ~ 45 cm/s, JMA 5+/6-)
    expect(bedrockPgv).toBeLessThan(300.0);
  });

  it('does not apply the removed ad-hoc slab path boost', () => {
    const baseline = calculateBedrockPgv(100, 200, 7, 0, 'crustal');
    const fullSlabPath = calculateBedrockPgv(100, 200, 7, 1, 'crustal');
    expect(fullSlabPath).toBe(baseline);
  });

  it('uses the actual depth in the baseline model', () => {
    const deepFocusPgv = calculateBedrockPgv(800, 470, 7.0);
    const deepestCalibratedPgv = calculateBedrockPgv(800, 60, 7.0);

    expect(deepFocusPgv / deepestCalibratedPgv).toBeCloseTo(10 ** (0.0038 * 410), 10);
  });

  it('calculates Morikawa correction terms at their specified boundaries', () => {
    expect(calculateMorikawaCorrectionTerms(300, 30, 100)).toEqual({ log10V1: 0, log10V2: 0 });
    expect(calculateMorikawaCorrectionTerms(300, 100, 100).log10V1)
      .toBeCloseTo((-4.0e-5 * 100 + 9.9e-3) * 70);
    expect(calculateMorikawaCorrectionTerms(300, 100, 400).log10V1).toBeCloseTo(-0.0061 * 70);
    expect(calculateMorikawaCorrectionTerms(300, 100, 247.5).log10V1).toBeCloseTo(0);
    expect(calculateMorikawaCorrectionTerms(600, 30, 100).log10V2)
      .toBeCloseTo(2.1 * Math.log10(2) - 0.01);

    const pacificSidePgv = calculateBedrockPgv(300, 100, 7, 0, 'crustal', undefined, undefined, 100);
    const seaOfJapanSidePgv = calculateBedrockPgv(300, 100, 7, 0, 'crustal', undefined, undefined, 400);
    expect(pacificSidePgv).toBeGreaterThan(seaOfJapanSidePgv);
  });

  it('computes trench distance to the axis and applies corrections to JMA predictions', () => {
    const [stationLat, stationLon] = PACIFIC_TRENCH_AXIS_POINTS[0];
    expect(calculateTrenchAxisDistanceKm(stationLat, stationLon)).toBeCloseTo(0, 8);

    const station = calculateJmaIntensity(400, 150, 7, 1, 0, undefined, stationLat, stationLon);
    expect(station.log10V1).toBeGreaterThan(0);
    expect(station.log10V2).toBeGreaterThan(0);
  });

  it('should scale surface PGV proportionally with site amplification factor ARV', () => {
    const bedrockPgv = 10.0; // 10 cm/s
    const pgvSoftSoil = calculateSurfacePgv(bedrockPgv, 2.5); // Soft soil ARV = 2.5
    const pgvHardRock = calculateSurfacePgv(bedrockPgv, 0.8); // Hard rock ARV = 0.8

    expect(pgvSoftSoil).toBe(25.0);
    expect(pgvHardRock).toBe(8.0);
  });

  it('should correctly quantize continuous JMA intensity into discrete 10-level JMA scales', () => {
    expect(quantizeJmaIntensity(0.2)).toBe('0');
    expect(quantizeJmaIntensity(0.5)).toBe('1');
    expect(quantizeJmaIntensity(1.49)).toBe('1');
    expect(quantizeJmaIntensity(1.50)).toBe('2');
    expect(quantizeJmaIntensity(2.49)).toBe('2');
    expect(quantizeJmaIntensity(2.50)).toBe('3');
    expect(quantizeJmaIntensity(3.49)).toBe('3');
    expect(quantizeJmaIntensity(3.50)).toBe('4');
    expect(quantizeJmaIntensity(4.49)).toBe('4');
    expect(quantizeJmaIntensity(4.50)).toBe('5-');
    expect(quantizeJmaIntensity(4.99)).toBe('5-');
    expect(quantizeJmaIntensity(5.00)).toBe('5+');
    expect(quantizeJmaIntensity(5.49)).toBe('5+');
    expect(quantizeJmaIntensity(5.50)).toBe('6-');
    expect(quantizeJmaIntensity(5.99)).toBe('6-');
    expect(quantizeJmaIntensity(6.00)).toBe('6+');
    expect(quantizeJmaIntensity(6.49)).toBe('6+');
    expect(quantizeJmaIntensity(6.50)).toBe('7');
    expect(quantizeJmaIntensity(7.20)).toBe('7');
  });

  it('should compute full JMA intensity pipeline accurately', () => {
    const res = calculateJmaIntensity(50.0, 15.0, 6.5, 1.5);
    expect(res.pgvSurface).toBeGreaterThan(0.0);
    expect(res.continuousIntensity).toBeGreaterThan(0.0);
    expect(['3', '4', '5-', '5+']).toContain(res.jmaScale);
  });
});
