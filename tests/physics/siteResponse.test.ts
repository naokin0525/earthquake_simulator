/**
 * tests/physics/siteResponse.test.ts
 * ==================================
 * Unit tests validating ground surface site amplification factors (ARV / AVS30).
 */

import { describe, it, expect } from 'vitest';
import {
  calculateArvFromVs30,
  calculateSurfacePgv,
  calculateSurfacePga
} from '../../src/core/physics/siteResponse';

describe('Site Response & Amplification Engine', () => {
  it('should compute valid ARV at engineering bedrock (AVS30 = 600 m/s ~ 1.0)', () => {
    const arvBedrock = calculateArvFromVs30(600.0);
    expect(arvBedrock).toBeCloseTo(0.992, 2); // ~1.0 baseline
  });

  it('should compute higher amplification for soft soil (AVS30 = 200 m/s)', () => {
    const arvSoft = calculateArvFromVs30(200.0);
    expect(arvSoft).toBeGreaterThan(1.8);
    expect(arvSoft).toBeLessThan(2.5);
  });

  it('should compute lower amplification for hard rock (AVS30 = 1200 m/s)', () => {
    const arvRock = calculateArvFromVs30(1200.0);
    expect(arvRock).toBeLessThan(0.8);
    expect(arvRock).toBeGreaterThan(0.5);
  });

  it('should proportionally scale bedrock PGV with ARV factor', () => {
    const bedrockPgv = 20.0;
    const pgvSurface = calculateSurfacePgv(bedrockPgv, 1.8);
    expect(pgvSurface).toBeCloseTo(36.0, 5);
  });

  it('should clamp minimum amplification factor to 0.5', () => {
    const bedrockPgv = 20.0;
    const pgvClamped = calculateSurfacePgv(bedrockPgv, 0.2); // Below 0.5 minimum
    expect(pgvClamped).toBe(10.0); // 20.0 * 0.5
  });

  it('should proportionally scale bedrock PGA with amplification factor', () => {
    const bedrockPga = 150.0;
    const pgaSurface = calculateSurfacePga(bedrockPga, 1.5);
    expect(pgaSurface).toBeCloseTo(225.0, 5);
  });
});
