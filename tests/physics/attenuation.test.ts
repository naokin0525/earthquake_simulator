/**
 * tests/physics/attenuation.test.ts
 * =================================
 * Unit tests validating Si & Midorikawa (1999) PGV formula and JMA intensity quantization.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateBedrockPgv,
  integrateDirectRayPath,
  calculateSurfacePgv,
  calculateContinuousJmaIntensity,
  quantizeJmaIntensity,
  calculateJmaIntensity
} from '../../src/core/physics/attenuation';
import { Slab2Model, SlabGridRaster } from '../../src/core/physics/slabModel';

function createSlabModel(withSlab: boolean): Slab2Model {
  const metadata = {
    id: 'test',
    label: 'test',
    depthImage: '',
    thicknessImage: '',
    minLon: 0,
    maxLon: 0.1,
    minLat: -0.1,
    maxLat: 0,
    width: 3,
    height: 3,
    gridStepDegrees: 0.05,
    depthOffsetKm: 0,
    depthScale: 1,
    thicknessOffsetKm: 0,
    thicknessScale: 1,
    validCells: 9
  };
  const depthPixels = new Uint8ClampedArray(3 * 3 * 4);
  const thicknessPixels = new Uint8ClampedArray(3 * 3 * 4);
  if (withSlab) {
    for (let i = 0; i < depthPixels.length; i += 4) {
      depthPixels[i + 1] = 51;
      thicknessPixels[i + 1] = 101;
    }
  }
  return Slab2Model.fromRasters([
    { metadata, depthPixels, thicknessPixels } satisfies SlabGridRaster
  ]);
}

describe('Si & Midorikawa (1999) PGV & JMA Intensity Engine', () => {
  it('should compute valid bedrock PGV for 2011 Tohoku Mw 9.0 benchmark at 100km distance', () => {
    // 2011 Tohoku Mw 9.0, depth = 24km, R = 100km
    const bedrockPgv = calculateBedrockPgv(100.0, 24.0, 9.0);
    expect(bedrockPgv).toBeGreaterThan(10.0); // > 10 cm/s
    expect(bedrockPgv).toBeLessThan(150.0);   // < 150 cm/s
  });

  it('should compute valid bedrock PGV for 2016 Kumamoto M 7.3 benchmark at near-field 20km distance', () => {
    // 2016 Kumamoto Mw 7.1 (Mj 7.3), depth = 12km, R = 20km
    const bedrockPgv = calculateBedrockPgv(20.0, 12.0, 7.1);
    expect(bedrockPgv).toBeGreaterThan(15.0); // Bedrock PGV ~ 22.8 cm/s (Surface PGV ~ 45 cm/s, JMA 5+/6-)
    expect(bedrockPgv).toBeLessThan(300.0);
  });

  it('uses the soft-saturating depth source term', () => {
    const atCriticalDepth = calculateBedrockPgv(100, 80, 7);
    const beyondCriticalDepth = calculateBedrockPgv(100, 160, 7);
    expect(beyondCriticalDepth / atCriticalDepth).toBeCloseTo(10 ** (0.0038 * 80 * Math.log(2)), 10);
  });

  it('falls back to the homogeneous Si & Midorikawa attenuation equation without Slab2 inputs', () => {
    const distance = 100;
    const depth = 100;
    const magnitude = 7;
    const sourceTerm = 0.0038 * 80 + 0.0038 * 80 * Math.log(1 + (depth - 80) / 80);
    const expected = 10 ** (
      0.58 * magnitude + sourceTerm + 0.12 - 1.29 -
      Math.log10(distance + 0.0028 * 10 ** (0.5 * magnitude)) -
      0.002 * distance
    );
    expect(calculateBedrockPgv(distance, depth, magnitude)).toBeCloseTo(expected, 12);
  });

  it('integrates crust, mantle wedge, and slab lengths on the direct ray', () => {
    const path = integrateDirectRayPath(0, 0.05, 100, 0, 0.05, createSlabModel(true), 5);
    expect(path.lCrustKm).toBeGreaterThan(0);
    expect(path.lSlabKm).toBeGreaterThan(0);
    expect(path.lWedgeKm).toBeGreaterThan(0);
    expect(path.totalInelasticLoss).toBeCloseTo(
      path.lCrustKm * 0.002 + path.lWedgeKm * 0.0055 + path.lSlabKm * 0.0004,
      10
    );

    const wedgePath = integrateDirectRayPath(0, 0.05, 100, 0, 0.05, undefined, 5);
    expect(wedgePath.lWedgeKm).toBeGreaterThan(0);
    expect(wedgePath.totalInelasticLoss).toBeGreaterThan(path.totalInelasticLoss);
  });

  it('uses a slab-guided path only when Slab2 data exists beneath the station', () => {
    const withSlab = createSlabModel(true);
    const withoutSlab = createSlabModel(false);
    const guidedPgv = calculateBedrockPgv(100, 100, 7, 0, 0.05, 0, 0.05, withSlab);
    const directOnlyPgv = calculateBedrockPgv(100, 100, 7, 0, 0.05, 0, 0.05, withoutSlab);
    expect(guidedPgv).toBeGreaterThan(directOnlyPgv);

    const shallowPgv = calculateBedrockPgv(100, 50, 7, 0, 0.05, 0, 0.05, withSlab);
    const shallowWithoutSlabPgv = calculateBedrockPgv(100, 50, 7, 0, 0.05, 0, 0.05, withoutSlab);
    expect(shallowPgv).toBeCloseTo(shallowWithoutSlabPgv, 10);
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
