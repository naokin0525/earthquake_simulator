import { IconLayer } from '@deck.gl/layers';
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import type { EarthquakeInfoReport, IntensityFlashReport, JmaIntensityScale } from '../../../core/types';
import { hexToRgba, JMA_INTENSITY_LEVELS } from '../../../core/ui/intensityColors';

type Point = [number, number];
type LinearRing = Position[];
type PolygonCoordinates = Position[][];
type AreaFeatureProperties = Record<string, unknown> & { pref?: number };

export type AreaGeometry = Polygon | MultiPolygon;
export type AreaFeature = Feature<AreaGeometry, AreaFeatureProperties>;
export type AreaFeatureCollection = FeatureCollection<AreaGeometry, AreaFeatureProperties>;

interface RingCentroid {
  position: Point;
  area: number;
}

type PolygonCentroid = RingCentroid;

function getRingCentroid(ring: LinearRing): RingCentroid | null {
  let twiceArea = 0;
  let xSum = 0;
  let ySum = 0;

  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    xSum += (x1 + x2) * cross;
    ySum += (y1 + y2) * cross;
  }

  if (Math.abs(twiceArea) < 1e-12) return null;
  return {
    position: [xSum / (3 * twiceArea), ySum / (3 * twiceArea)],
    area: Math.abs(twiceArea) / 2
  };
}

function getPolygonCentroid(rings: PolygonCoordinates): PolygonCentroid | null {
  const outer = getRingCentroid(rings[0] ?? []);
  if (!outer) return null;

  let area = outer.area;
  let xWeighted = outer.position[0] * outer.area;
  let yWeighted = outer.position[1] * outer.area;
  for (const hole of rings.slice(1)) {
    const holeCentroid = getRingCentroid(hole);
    if (!holeCentroid) continue;
    area -= holeCentroid.area;
    xWeighted -= holeCentroid.position[0] * holeCentroid.area;
    yWeighted -= holeCentroid.position[1] * holeCentroid.area;
  }

  if (area <= 0) return outer;
  return {
    position: [xWeighted / area, yWeighted / area],
    area
  };
}

function getPolygonCentroids(geometry: AreaGeometry): PolygonCentroid[] {
  const polygons = geometry.type === 'Polygon'
    ? [geometry.coordinates as PolygonCoordinates]
    : geometry.coordinates as PolygonCoordinates[];
  return polygons
    .map(getPolygonCentroid)
    .filter((centroid): centroid is PolygonCentroid => centroid !== null)
    .sort((a, b) => b.area - a.area);
}

export function getRegionMidpoint(geometry: AreaGeometry): Point | null {
  const polygons = getPolygonCentroids(geometry);
  const totalArea = polygons.reduce((sum, polygon) => sum + polygon.area, 0);
  if (totalArea === 0) return null;

  return [
    polygons.reduce((sum, polygon) => sum + polygon.position[0] * polygon.area, 0) / totalArea,
    polygons.reduce((sum, polygon) => sum + polygon.position[1] * polygon.area, 0) / totalArea
  ];
}

export interface RegionIntensityMarker {
  position: Point;
  intensity: JmaIntensityScale;
}

export type RegionalIntensityReport = Pick<IntensityFlashReport | EarthquakeInfoReport, 'prefectures'>;

export function shouldShowRegionIntensityIcons(
  mode: string,
  isZoomedIn: boolean
): boolean {
  return mode === 'flash' || (mode === 'detail' && !isZoomedIn);
}

export function getRegionIntensityMap(
  report: RegionalIntensityReport | null
): Map<string, JmaIntensityScale> {
  return new Map(report?.prefectures.map((entry) => [entry.prefName, entry.maxIntensity]) ?? []);
}

export function getRegionIntensityMarkers(
  regions: AreaFeatureCollection,
  report: RegionalIntensityReport | null
): RegionIntensityMarker[] {
  if (!report) return [];

  return report.prefectures.flatMap((entry) => {
    const feature = regions.features.find((candidate) =>
      candidate.properties.name === entry.prefName
    ) ?? (entry.prefCode > 0
      ? regions.features
        .filter((candidate) => candidate.properties.pref === entry.prefCode)
        .sort((a, b) => {
          const area = (geometry: AreaGeometry) =>
            getPolygonCentroids(geometry).reduce((sum, polygon) => sum + polygon.area, 0);
          return area(b.geometry) - area(a.geometry);
        })[0]
      : undefined);
    const position = feature ? getRegionMidpoint(feature.geometry) : null;
    return position ? [{ position, intensity: entry.maxIntensity }] : [];
  });
}

export function getReportedRegionIntensity(
  feature: AreaFeature,
  intensityByRegion: ReadonlyMap<string, JmaIntensityScale>
): JmaIntensityScale | undefined {
  const regionName = feature.properties.name;
  return typeof regionName === 'string' ? intensityByRegion.get(regionName) : undefined;
}

function intensityLabel(intensity: JmaIntensityScale): string {
  if (intensity === '5-') return '5弱';
  if (intensity === '5+') return '5強';
  if (intensity === '6-') return '6弱';
  if (intensity === '6+') return '6強';
  return intensity;
}

function intensityColor(intensity: JmaIntensityScale): [number, number, number, number] {
  const colour = JMA_INTENSITY_LEVELS.find((level) => level.scale === intensity)?.colour ?? '#FFFFFF';
  return hexToRgba(colour, 245);
}

export function getIntensityBorderColor(intensity: JmaIntensityScale): string {
  const [red, green, blue] = intensityColor(intensity);
  const brightness = 0.299 * red + 0.587 * green + 0.114 * blue;
  const isBright = brightness >= 127.5;
  const adjustedBrightness = isBright
    ? brightness * 0.865
    : brightness + (255 - brightness) * 0.135;
  const saturationScale = isBright ? 1.2 : 0.8;
  const adjustedChannels = [red, green, blue].map((channel) =>
    Math.min(255, Math.max(0, Math.round(
      adjustedBrightness + (channel - brightness) * saturationScale
    )))
  );
  return `#${adjustedChannels
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

const intensityIconUrls = new Map<JmaIntensityScale, string>(
  JMA_INTENSITY_LEVELS.map(({ scale }) => {
    const [red, green, blue] = intensityColor(scale);
    const [r, g, b] = [red, green, blue];
    const textColor = 0.299 * r + 0.587 * g + 0.114 * b >= 150
      ? '#141414'
      : '#ffffff';
    const borderColor = getIntensityBorderColor(scale);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="62" height="62" viewBox="0 0 62 62" data-intensity-code="${scale}" aria-label="震度${intensityLabel(scale)}"><rect x="1" y="1" width="60" height="60" rx="10" fill="rgb(${red},${green},${blue})" stroke="${borderColor}" stroke-width="6"/><text x="31" y="28" font-size="35" font-family="sans-serif" text-anchor="middle" dominant-baseline="central" fill="${textColor}" stroke="${textColor}" stroke-width="1">${intensityLabel(scale)}</text></svg>`;
    return [scale, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`];
  })
);

export function getIntensityIcon(intensity: JmaIntensityScale) {
  const url = intensityIconUrls.get(intensity);
  if (!url) {
    throw new Error(`Missing intensity icon for JMA scale "${intensity}"`);
  }
  return { url, width: 62, height: 62, anchorY: 20 };
}

export function createRegionIntensityLayers(
  regions: AreaFeatureCollection | null,
  report: RegionalIntensityReport | null
): IconLayer[] {
  if (!regions || !report) return [];
  const markers = getRegionIntensityMarkers(regions, report);
  if (markers.length === 0) return [];

  return [
    new IconLayer<RegionIntensityMarker>({
      id: 'flash-report-intensity-badges',
      data: markers,
      getPosition: (marker) => marker.position,
      getIcon: (marker) => getIntensityIcon(marker.intensity),
      getColor: [255, 255, 255, 255],
      getSize: 24,
      sizeUnits: 'pixels',
      sizeMinPixels: 18,
      sizeMaxPixels: 32,
      pickable: false,
    })
  ];
}
