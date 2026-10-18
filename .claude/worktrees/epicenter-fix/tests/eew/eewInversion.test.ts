/**
 * tests/eew/eewInversion.test.ts
 * ==============================
 * Unit tests validating multi-stage EEW hypocenter inversion convergence and warning alert triggering.
 */

import { describe, it, expect } from 'vitest';
import { estimateHypocenterAndMagnitude, TriggeredObservation } from '../../src/core/eew/eewInversion';
import { EEWEngine } from '../../src/core/eew/EEWEngine';
import { haversineDistance } from '../../src/core/physics/travelTime';

describe('EEW Inversion & Warning Alert Engine', () => {
  const trueHypo = { lat: 35.5, lon: 139.5, depth: 30.0, magnitude: 6.8, originTime: 0.0 };

  // Simulated 5 station coordinates surrounding the true epicenter
  const stationCoords = [
    { lat: 35.6, lon: 139.6 },
    { lat: 35.3, lon: 139.4 },
    { lat: 35.7, lon: 139.2 },
    { lat: 35.4, lon: 139.8 },
    { lat: 35.8, lon: 139.9 }
  ];

  it('should generate initial Report #1 given a single station trigger', () => {
    const singleObs: TriggeredObservation[] = [
      { lat: 35.6, lon: 139.6, tObs: 6.0, ampFactor: 1.5 }
    ];

    const estHypo = estimateHypocenterAndMagnitude(singleObs);
    expect(estHypo.lat).toBe(35.6);
    expect(estHypo.lon).toBe(139.6);
    expect(estHypo.depth).toBe(10.0);
  });

  it('should converge within 15km of true epicenter given >= 4 noisy triggered stations', () => {
    const observations: TriggeredObservation[] = [];

    for (let i = 0; i < stationCoords.length; i++) {
      const st = stationCoords[i];
      const delta = haversineDistance(trueHypo.lat, trueHypo.lon, st.lat, st.lon);
      const R = Math.sqrt(delta * delta + trueHypo.depth * trueHypo.depth);
      
      const noise = (i % 2 === 0 ? 0.1 : -0.1);
      const tObs = trueHypo.originTime + R / 6.0 + noise;

      observations.push({
        lat: st.lat,
        lon: st.lon,
        tObs,
        ampFactor: 1.5,
        measuredPgv: 35.0 // ~35 cm/s measured surface PGV (strong motion)
      });
    }

    const estHypo = estimateHypocenterAndMagnitude(observations);

    const epicentralErrorKm = haversineDistance(trueHypo.lat, trueHypo.lon, estHypo.lat, estHypo.lon);

    expect(epicentralErrorKm).toBeLessThan(15.0); // Epicenter error < 15 km
    expect(Math.abs(estHypo.depth - trueHypo.depth)).toBeLessThanOrEqual(40.0);
    expect(estHypo.magnitude).toBeGreaterThan(5.0);
  });

  it('should issue EEW Warning when predicted intensity is >= 5-', () => {
    const eewEngine = new EEWEngine();

    const triggerEvents = [
      {
        stationIndex: 0,
        state: 1, // P_TRIGGERED
        triggerTime: 3.0,
        pArrivalTime: 3.0,
        sArrivalTime: 6.0,
        pgvSurface: 45.0, // High PGV (intensity 5+)
        intensity: '5+' as const,
        continuousIntensity: 5.2
      },
      {
        stationIndex: 1,
        state: 1,
        triggerTime: 4.0,
        pArrivalTime: 4.0,
        sArrivalTime: 7.5,
        pgvSurface: 55.0, // High PGV (intensity 6-)
        intensity: '6-' as const,
        continuousIntensity: 5.6
      }
    ];

    const lats = new Float32Array([35.6, 35.3]);
    const lons = new Float32Array([139.6, 139.4]);
    const amps = new Float32Array([1.5, 1.8]);

    const report = eewEngine.update(triggerEvents, lats, lons, amps);

    expect(report).not.toBeNull();
    expect(report!.reportNumber).toBe(1);
    expect(report!.isWarning).toBe(true);
    expect(report!.warnedPrefectures.length).toBe(47);
  });
});
