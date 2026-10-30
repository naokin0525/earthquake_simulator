import { IconLayer } from '@deck.gl/layers';
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import type { EEWReport, JmaIntensityScale } from '../../../core/types';
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

function pointInRing(point: Point, ring: LinearRing): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInGeometry(point: Point, geometry: AreaGeometry): boolean {
  const polygons = geometry.type === 'Polygon'
    ? [geometry.coordinates as PolygonCoordinates]
    : geometry.coordinates as PolygonCoordinates[];

  return polygons.some((rings) =>
    pointInRing(point, rings[0] ?? []) &&
    !rings.slice(1).some((hole) => pointInRing(point, hole))
  );
}

function findPrefectureCode(
  region: AreaFeature,
  prefectures: AreaFeatureCollection
): number | undefined {
  const declaredPrefecture = region.properties.pref;
  if (typeof declaredPrefecture === 'number' && Number.isFinite(declaredPrefecture)) {
    return declaredPrefecture;
  }

  const candidateCenters = getPolygonCentroids(region.geometry);
  for (const candidate of candidateCenters) {
    const prefecture = prefectures.features.find((feature) => pointInGeometry(candidate.position, feature.geometry));
    const code = prefecture?.properties.pref;
    if (typeof code === 'number' && Number.isFinite(code)) return code;
  }

  const midpoint = getRegionMidpoint(region.geometry);
  if (!midpoint) return undefined;
  const prefecture = prefectures.features.find((feature) => pointInGeometry(midpoint, feature.geometry));
  const code = prefecture?.properties.pref;
  return typeof code === 'number' && Number.isFinite(code) ? code : undefined;
}

export function assignRegionPrefectureCodes(
  regions: AreaFeatureCollection,
  prefectures: AreaFeatureCollection
): AreaFeatureCollection {
  return {
    ...regions,
    features: regions.features.map((feature) => {
      const pref = findPrefectureCode(feature, prefectures);
      if (pref === undefined) {
        throw new Error(`Could not map JMA sub-region ${String(feature.properties.code)} to a prefecture`);
      }
      return { ...feature, properties: { ...feature.properties, pref } };
    })
  };
}

export interface RegionIntensityMarker {
  position: Point;
  intensity: JmaIntensityScale;
}

export function getRegionIntensityMarkers(
  regions: AreaFeatureCollection,
  report: EEWReport | null
): RegionIntensityMarker[] {
  if (!report) return [];

  const forecastByPrefecture = new Map(
    report.warnedPrefectures
      .filter((warning) => warning.isForecast || warning.isWarning)
      .map((warning) => [warning.prefCode, warning.maxPredictedIntensity])
  );

  return regions.features.flatMap((feature) => {
    const intensity = forecastByPrefecture.get(feature.properties.pref ?? -1);
    const position = getRegionMidpoint(feature.geometry);
    return intensity && position ? [{ position, intensity }] : [];
  });
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

const intensityIconUrls = new Map<JmaIntensityScale, string>();

function getIntensityIcon(intensity: JmaIntensityScale) {
  let url = intensityIconUrls.get(intensity);
  if (!url) {
    const [red, green, blue] = intensityColor(intensity);
    const textColor = intensity === '0' || intensity === '1' || intensity === '2' || intensity === '3' || intensity === '4'
      ? '#141414'
      : '#ffffff';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="rgb(${red},${green},${blue})" stroke="#ffffff" stroke-width="2"/><text x="20" y="20" text-anchor="middle" dominant-baseline="central" fill="${textColor}" font-family="sans-serif" font-size="12" font-weight="700">${intensityLabel(intensity)}</text></svg>`;
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    intensityIconUrls.set(intensity, url);
  }

  return { url, width: 40, height: 40, anchorY: 20 };
}

export function createRegionIntensityLayers(
  regions: AreaFeatureCollection | null,
  report: EEWReport | null
): IconLayer[] {
  if (!regions || !report) return [];
  const markers = getRegionIntensityMarkers(regions, report);
  if (markers.length === 0) return [];

  return [
    new IconLayer<RegionIntensityMarker>({
      id: 'eew-region-intensity-badges',
      data: markers,
      getPosition: (marker) => marker.position,
      getIcon: (marker) => getIntensityIcon(marker.intensity),
      getColor: [255, 255, 255, 255],
      getSize: 24,
      sizeUnits: 'pixels',
      pickable: false,
    })
  ];
}
