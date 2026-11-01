import { describe, it, expect } from 'vitest';
import {
  generateGeodesicCirclePaths,
  normalizeLongitude,
  WaveFrontLayer,
  createWaveFrontLayers
} from '../../src/components/map/layers/WaveFrontLayer';
import { computeTravelTimeAtDistance, computeWavefrontRadiusKm } from '../../src/core/physics/travelTime';
import type { EarthquakeHypocenter, EEWReport } from '../../src/core/types';

describe('WaveFrontLayer & Seismological Wavefront Calculations', () => {
  describe('JMA table isochrones', () => {
    it('interpolates JMA2020a shallow-source table entries', () => {
      expect(computeTravelTimeAtDistance(0, 2, 'P')).toBeCloseTo(0.417, 3);
      expect(computeTravelTimeAtDistance(0, 2, 'S')).toBeCloseTo(0.715, 3);
      expect(computeTravelTimeAtDistance(1, 0, 'P')).toBeCloseTo(0.208, 3);
    });

    it('uses the deeper-source JMA2001 table', () => {
      expect(computeTravelTimeAtDistance(10, 0, 'P')).toBeCloseTo(1.773, 3);
      expect(computeTravelTimeAtDistance(10, 0, 'S')).toBeCloseTo(3.007, 3);
    });

    it('inverts table travel times to recover surface wavefront radii', () => {
      for (const phase of ['P', 'S'] as const) {
        const distanceKm = 137;
        const travelTime = computeTravelTimeAtDistance(25, distanceKm, phase);
        expect(computeWavefrontRadiusKm(travelTime, 25, phase)).toBeCloseTo(distanceKm, 4);
      }
    });

    it('returns no surface radius before the source-depth arrival time', () => {
      expect(computeWavefrontRadiusKm(0.1, 20, 'P')).toBe(0);
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

    it('uses supplied simulation radii even when currentTime is present', () => {
      const layer = new WaveFrontLayer({
        id: 'test-wf',
        trueHypocenter: dummyHypo,
        currentTime: 101.0,
        pRadiusKm: 30,
        sRadiusKm: 0
      });
      const sublayers = layer.renderLayers();
      expect(sublayers.map((sublayer) => sublayer.id)).toEqual(['test-wf-true-p']);
    });

    it('derives both wavefronts from travel-time tables when radii are omitted', () => {
      const layer = new WaveFrontLayer({
        id: 'test-wf',
        trueHypocenter: dummyHypo,
        currentTime: 110.0
      });
      const sublayers = layer.renderLayers();
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
