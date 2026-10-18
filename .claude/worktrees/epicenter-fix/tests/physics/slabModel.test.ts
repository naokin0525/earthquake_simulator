/**
 * tests/physics/slabModel.test.ts
 * ================================
 * Unit tests validating subducting slab geometry and deep event anomalous seismic intensity (異常震域).
 */

import { describe, it, expect } from 'vitest';
import { calculateSlabFraction } from '../../src/core/physics/slabModel';
import { computeTravelTimes } from '../../src/core/physics/travelTime';
import { calculateBedrockPgv } from '../../src/core/physics/attenuation';

describe('Subducting Slab & Anomalous Seismic Intensity Model', () => {
  it('should return 0 slab fraction for shallow hypocenters (depth < 80km)', () => {
    const rSlabShallow = calculateSlabFraction(35.5, 139.0, 30.0, 36.0, 140.0);
    expect(rSlabShallow).toBe(0.0);
  });

  it('should produce positive slab fraction for deep hypocenters heading eastward toward Pacific trench', () => {
    // Deep hypocenter D=350km beneath Sea of Japan / Vladivostok (40.0N, 135.0E)
    // Station on Pacific coast (Sanriku/Miyagi: 38.3N, 141.0E)
    const rSlabPacific = calculateSlabFraction(40.0, 135.0, 350.0, 38.3, 141.0);
    expect(rSlabPacific).toBeGreaterThan(0.2);

    // Station heading westward (toward China/Russia)
    const rSlabWest = calculateSlabFraction(40.0, 135.0, 350.0, 40.0, 130.0);
    expect(rSlabWest).toBe(0.0);
  });

  it('should boost wave velocity and reduce attenuation along slab-dominated ray paths for deep events', () => {
    const hypoDeep = { lat: 40.0, lon: 135.0, depth: 350.0, magnitude: 7.0, originTime: 0.0 };
    const pacificLat = 38.3, pacificLon = 141.0;

    const rSlab = calculateSlabFraction(hypoDeep.lat, hypoDeep.lon, hypoDeep.depth, pacificLat, pacificLon);
    const tt = computeTravelTimes(hypoDeep, pacificLat, pacificLon, rSlab);

    expect(tt.vP).toBeGreaterThan(6.0); // Velocity boosted above baseline 6.0 km/s
    expect(tt.vS).toBeGreaterThan(3.5); // Velocity boosted above baseline 3.5 km/s

    // Bedrock PGV with slab model vs without slab model
    const pgvWithSlab = calculateBedrockPgv(tt.hypocentralDistance, hypoDeep.depth, hypoDeep.magnitude, rSlab);
    const pgvNoSlab = calculateBedrockPgv(tt.hypocentralDistance, hypoDeep.depth, hypoDeep.magnitude, 0.0);

    expect(pgvWithSlab).toBeGreaterThan(pgvNoSlab); // Less attenuation along cold slab path
  });
});
