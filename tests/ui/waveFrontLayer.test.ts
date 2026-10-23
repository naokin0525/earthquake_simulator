import { describe, it, expect } from 'vitest';
import {
  calculateSurfaceWaveRadius,
  generateGeodesicCirclePaths,
  normalizeLongitude,
  WaveFrontLayer,
  createWaveFrontLayers
} from '../../src/components/map/layers/WaveFrontLayer';
import type { EarthquakeHypocenter, EEWReport } from '../../src/core/types';

describe('WaveFrontLayer & Seismological Wavefront Calculations', () => {
  describe('calculateSurfaceWaveRadius (Depth & Wave Propagation Physics)', () => {
    it('returns 0 when elapsed time is zero or negative', () => {
      expect(calculateSurfaceWaveRadius(0, 30, 6.0)).toBe(0);
      expect(calculateSurfaceWaveRadius(-2.5, 30, 6.0)).toBe(0);
    });

    it('returns 0 when 3D wavefront has not reached the surface (radius < depth)', () => {
      // Hypocenter depth = 30 km, vP = 6.0 km/s -> breaches surface at 30 / 6 = 5.0 seconds
      expect(calculateSurfaceWaveRadius(1.0, 30, 6.0)).toBe(0); // 3D radius = 6 km < 30 km
      expect(calculateSurfaceWaveRadius(3.0, 30, 6.0)).toBe(0); // 3D radius = 18 km < 30 km
      expect(calculateSurfaceWaveRadius(4.99, 30, 6.0)).toBe(0); // 3D radius = 29.94 km < 30 km
      expect(calculateSurfaceWaveRadius(5.0, 30, 6.0)).toBe(0); // 3D radius = 30 km == depth
    });

    it('returns correct surface radius sqrt(R^2 - d^2) once wavefront breaches surface', () => {
      // At t = 6.0s: 3D radius = 36 km, depth = 30 km
      // Surface radius = sqrt(36^2 - 30^2) = sqrt(1296 - 900) = sqrt(396) ≈ 19.8997 km
      const r = calculateSurfaceWaveRadius(6.0, 30, 6.0);
      expect(r).toBeCloseTo(Math.sqrt(396), 4);
    });

    it('correctly models S-wave arrival delay due to hypocenter depth', () => {
      // Hypocenter depth = 10 km, vS = 3.5 km/s -> breaches surface at 10 / 3.5 ≈ 2.857s
      expect(calculateSurfaceWaveRadius(2.0, 10, 3.5)).toBe(0); // 7 km < 10 km
      const rS = calculateSurfaceWaveRadius(4.0, 10, 3.5); // 3D radius = 14 km
      // Surface radius = sqrt(14^2 - 10^2) = sqrt(196 - 100) = sqrt(96) ≈ 9.79796 km
      expect(rS).toBeCloseTo(Math.sqrt(96), 4);
    });
  });

  describe('normalizeLongitude', () => {
    it('normalizes arbitrary longitudes strictly into [-180, 180]', () => {
      expect(normalizeLongitude(0)).toBe(0);
      expect(normalizeLongitude(138.5)).toBeCloseTo(138.5);
      expect(normalizeLongitude(-120)).toBeCloseTo(-120);
      expect(normalizeLongitude(190)).toBeCloseTo(-170);
      expect(normalizeLongitude(-190)).toBeCloseTo(170);
      expect(normalizeLongitude(540)).toBeCloseTo(180);
    });
  });

  describe('generateGeodesicCirclePaths (Antimeridian Crossing & Date Line Handling)', () => {
    it('returns empty array when radius <= 0.1 km', () => {
      expect(generateGeodesicCirclePaths(35.0, 138.0, 0.05)).toEqual([]);
    });

    it('returns single closed path for circle away from dateline', () => {
      const paths = generateGeodesicCirclePaths(35.0, 138.0, 100.0, 64);
      expect(paths.length).toBe(1);
      const ring = paths[0];
      expect(ring.length).toBeGreaterThan(60);

      // Verify all points are continuous with no jump > 180°
      for (let i = 1; i < ring.length; i++) {
        const deltaLon = Math.abs(ring[i][0] - ring[i - 1][0]);
        expect(deltaLon).toBeLessThanOrEqual(180);
      }
    });

    it('splits into 2 clean segments when crossing the International Date Line (±180° lon)', () => {
      // Circle centered at lon 179.5 with radius 200 km crosses longitude 180°
      const paths = generateGeodesicCirclePaths(35.0, 179.5, 200.0, 64);
      expect(paths.length).toBe(2);

      // Verify each segment has no adjacent points jumping > 180° (preventing screen tearing)
      for (const segment of paths) {
        expect(segment.length).toBeGreaterThan(5);
        for (let i = 1; i < segment.length; i++) {
          const deltaLon = Math.abs(segment[i][0] - segment[i - 1][0]);
          expect(deltaLon).toBeLessThanOrEqual(180);
        }
      }
    });
  });

  describe('WaveFrontLayer (Deck.gl CompositeLayer & Type Safety)', () => {
    const dummyHypo: EarthquakeHypocenter = {
      lat: 36.0,
      lon: 139.0,
      depth: 20.0,
      magnitude: 6.0,
      originTime: 100.0
    };

    it('instantiates cleanly and renders 0 sublayers before wave reaches surface', () => {
      const layer = new WaveFrontLayer({
        id: 'test-wf',
        trueHypocenter: dummyHypo,
        currentTime: 101.0 // 1s elapsed: vP * 1 = 6km < depth 20km
      });
      const sublayers = layer.renderLayers();
      expect(sublayers.length).toBe(0);
    });

    it('renders PathLayer once P-wave breaches surface (t > depth / vP)', () => {
      const layer = new WaveFrontLayer({
        id: 'test-wf',
        trueHypocenter: dummyHypo,
        currentTime: 105.0 // 5s elapsed: vP * 5 = 30km > depth 20km, vS * 5 = 17.5km < 20km
      });
      const sublayers = layer.renderLayers();
      expect(sublayers.length).toBe(1);
      expect(sublayers[0].id).toBe('test-wf-true-p');
    });

    it('renders both P and S wave rings when both have breached surface', () => {
      const layer = new WaveFrontLayer({
        id: 'test-wf',
        trueHypocenter: dummyHypo,
        currentTime: 110.0 // 10s elapsed: vP * 10 = 60km, vS * 10 = 35km > depth 20km
      });
      const sublayers = layer.renderLayers();
      expect(sublayers.length).toBe(2);
      expect(sublayers.map((l) => l.id)).toEqual(['test-wf-true-p', 'test-wf-true-s']);
    });

    it('renders EEW estimated wave rings taking estimated hypocenter depth into account', () => {
      const eewReport: EEWReport = {
        reportNumber: 1,
        isFinal: false,
        isWarning: true,
        originTime: 100.0,
        triggeredStationCount: 5,
        maxPredictedIntensity: '5+',
        warnedPrefectures: [],
        estimatedHypocenter: {
          lat: 36.1,
          lon: 139.1,
          depth: 15.0,
          magnitude: 6.2,
          originTime: 100.0
        }
      };

      const layer = new WaveFrontLayer({
        id: 'test-wf',
        trueHypocenter: dummyHypo,
        eewReport,
        currentTime: 110.0
      });
      const sublayers = layer.renderLayers();
      // True P, True S, Est P, Est S
      expect(sublayers.length).toBe(4);
      expect(sublayers.map((l) => l.id)).toEqual([
        'test-wf-true-p',
        'test-wf-true-s',
        'test-wf-est-p',
        'test-wf-est-s'
      ]);
    });

    it('supports backward compatibility function createWaveFrontLayers', () => {
      const layers = createWaveFrontLayers({
        trueHypocenter: dummyHypo,
        currentTime: 110.0
      });
      expect(layers.length).toBe(1);
      expect(layers[0]).toBeInstanceOf(WaveFrontLayer);
    });
  });
});
