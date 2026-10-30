import { describe, expect, it } from 'vitest';
import type { EEWReport } from '../../src/core/types';
import {
  assignRegionPrefectureCodes,
  getRegionIntensityMarkers,
  getRegionMidpoint,
  type AreaFeature,
  type AreaFeatureCollection
} from '../../src/components/map/layers/SubRegionLayer';

const squareGeometry = (west: number, south: number, east: number, north: number) => ({
  type: 'Polygon' as const,
  coordinates: [[
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south]
  ]] as [number, number][][]
});

function feature(
  properties: AreaFeature['properties'],
  geometry: AreaFeature['geometry']
): AreaFeature {
  return { type: 'Feature', properties, geometry };
}

describe('JMA sub-region map data', () => {
  it('calculates the area-weighted midpoint for polygon and multipolygon features', () => {
    expect(getRegionMidpoint(squareGeometry(0, 0, 2, 2))).toEqual([1, 1]);
    expect(getRegionMidpoint({
      type: 'MultiPolygon',
      coordinates: [
        squareGeometry(0, 0, 2, 2).coordinates,
        squareGeometry(4, 0, 6, 2).coordinates
      ]
    })).toEqual([3, 1]);
  });

  it('maps each forecast region to its containing prefecture', () => {
    const regions: AreaFeatureCollection = {
      type: 'FeatureCollection',
      features: [feature({ code: '101', name: 'North area' }, squareGeometry(1, 1, 2, 2))]
    };
    const prefectures: AreaFeatureCollection = {
      type: 'FeatureCollection',
      features: [feature({ pref: 13, name: 'Tokyo' }, squareGeometry(0, 0, 3, 3))]
    };

    expect(assignRegionPrefectureCodes(regions, prefectures).features[0].properties.pref).toBe(13);
  });

  it('creates one EEW intensity marker for every forecast sub-region', () => {
    const regions: AreaFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        feature({ code: '101', pref: 13 }, squareGeometry(0, 0, 2, 2)),
        feature({ code: '102', pref: 14 }, squareGeometry(2, 0, 4, 2))
      ]
    };
    const report: EEWReport = {
      reportNumber: 1,
      isFinal: false,
      isWarning: true,
      estimatedHypocenter: { lat: 35, lon: 139, depth: 10, magnitude: 6, originTime: 0 },
      originTime: 0,
      triggeredStationCount: 2,
      maxPredictedIntensity: '5-',
      warnedPrefectures: [
        {
          prefCode: 13,
          prefName: 'Tokyo',
          maxPredictedIntensity: '5-',
          maxPredictedLpgmClass: 0,
          isWarning: true,
          isForecast: true
        },
        {
          prefCode: 14,
          prefName: 'Kanagawa',
          maxPredictedIntensity: '3',
          maxPredictedLpgmClass: 0,
          isWarning: false,
          isForecast: true
        }
      ]
    };

    expect(getRegionIntensityMarkers(regions, report)).toEqual([
      { position: [1, 1], intensity: '5-' },
      { position: [3, 1], intensity: '3' }
    ]);
  });
});
