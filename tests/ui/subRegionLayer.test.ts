import { describe, expect, it } from 'vitest';
import type { IntensityFlashReport, JmaIntensityScale } from '../../src/core/types';
import { JMA_INTENSITY_LEVELS } from '../../src/core/ui/intensityColors';
import {
  createRegionIntensityLayers,
  getIntensityBorderColor,
  getIntensityIcon,
  getRegionIntensityMap,
  getRegionIntensityMarkers,
  getRegionMidpoint,
  getReportedRegionIntensity,
  shouldShowRegionIntensityIcons,
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

  it('uses the prefecture code already present in generated region data', () => {
    const regions: AreaFeatureCollection = {
      type: 'FeatureCollection',
      features: [feature({ code: '101', name: 'North area', pref: 13 }, squareGeometry(1, 1, 2, 2))]
    };

    expect(regions.features[0].properties.pref).toBe(13);
  });

  it('creates an intensity marker for each area in an issued flash report only', () => {
    const regions: AreaFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        feature({ code: '101', pref: 13 }, squareGeometry(0, 0, 2, 2)),
        feature({ code: '102', pref: 14 }, squareGeometry(2, 0, 4, 2))
      ]
    };
    const report: IntensityFlashReport = {
      issuedTime: 90,
      maxIntensity: '5-',
      intensities: { '3': ['North area'], '5-': ['South area'] },
      summary: 'test report',
      prefectures: [
        {
          prefCode: 13,
          prefName: 'North area',
          maxIntensity: '3'
        },
        {
          prefCode: 14,
          prefName: 'South area',
          maxIntensity: '5-'
        }
      ]
    };

    expect(getRegionIntensityMarkers(regions, null)).toEqual([]);
    expect(createRegionIntensityLayers(regions, null)).toEqual([]);
    expect(getRegionIntensityMarkers(regions, report)).toEqual([
      { position: [1, 1], intensity: '3' },
      { position: [3, 1], intensity: '5-' }
    ]);
    const layer = createRegionIntensityLayers(regions, report)[0];
    expect(layer.props.sizeMinPixels).toBe(18);
    expect(layer.props.sizeMaxPixels).toBe(32);
  });

  it('limits regional icons to bulletin/detail modes and hides them at close detail zoom', () => {
    expect(shouldShowRegionIntensityIcons('flash', true)).toBe(true);
    expect(shouldShowRegionIntensityIcons('detail', false)).toBe(true);
    expect(shouldShowRegionIntensityIcons('detail', true)).toBe(false);
    expect(shouldShowRegionIntensityIcons('auto', false)).toBe(false);
    expect(shouldShowRegionIntensityIcons('estimated', false)).toBe(false);
  });

  it('matches report intensities to regions for map tinting', () => {
    const region = feature({ code: '101', name: 'North area', pref: 13 }, squareGeometry(0, 0, 2, 2));
    const report: IntensityFlashReport = {
      issuedTime: 90,
      maxIntensity: '5-',
      intensities: { '5-': ['North area'] },
      summary: 'test report',
      prefectures: [{ prefCode: 13, prefName: 'North area', maxIntensity: '5-' }]
    };

    expect(getReportedRegionIntensity(region, getRegionIntensityMap(report))).toBe('5-');
    expect(getReportedRegionIntensity(region, getRegionIntensityMap(null))).toBeUndefined();
  });

  it('generates report icons for every JMA scale with matching fill and contrasting borders', () => {
    const luminance = (hex: string) => {
      const channels = hex.slice(1).match(/.{2}/g)!.map((channel) => Number.parseInt(channel, 16));
      return 0.299 * channels[0] + 0.587 * channels[1] + 0.114 * channels[2];
    };

    for (const { scale, colour } of JMA_INTENSITY_LEVELS) {
      const encodedSvg = getIntensityIcon(scale).url.split(',')[1];
      const svg = decodeURIComponent(encodedSvg);
      expect(svg).toContain(`data-intensity-code="${scale}"`);
      expect(svg).toContain(`fill="rgb(${Number.parseInt(colour.slice(1, 3), 16)},${Number.parseInt(colour.slice(3, 5), 16)},${Number.parseInt(colour.slice(5, 7), 16)})"`);
      expect(svg).toContain(`stroke="${getIntensityBorderColor(scale)}"`);
      expect(getIntensityBorderColor(scale)).not.toBe('#ffffff');

      const sourceBrightness = luminance(colour);
      const borderBrightness = luminance(getIntensityBorderColor(scale));
      const expectedBrightness = sourceBrightness >= 127.5
        ? sourceBrightness * 0.865
        : sourceBrightness + (255 - sourceBrightness) * 0.135;
      const sourceChannels = colour.slice(1).match(/.{2}/g)!.map((channel) => Number.parseInt(channel, 16));
      const borderChannels = getIntensityBorderColor(scale).slice(1).match(/.{2}/g)!
        .map((channel) => Number.parseInt(channel, 16));
      const saturationScale = sourceBrightness >= 127.5 ? 1.2 : 0.8;

      expect(borderBrightness).toBeCloseTo(expectedBrightness, 0);
      for (let channel = 0; channel < 3; channel++) {
        expect(Math.abs(
          borderChannels[channel] - borderBrightness -
          (sourceChannels[channel] - sourceBrightness) * saturationScale
        )).toBeLessThanOrEqual(1);
      }
      expect(sourceBrightness >= 127.5 ? borderBrightness < sourceBrightness : borderBrightness > sourceBrightness).toBe(true);
    }

    expect(JMA_INTENSITY_LEVELS.map(({ scale }) => scale)).toEqual(
      ['0', '1', '2', '3', '4', '5-', '5+', '6-', '6+', '7'] satisfies JmaIntensityScale[]
    );
  });
});
