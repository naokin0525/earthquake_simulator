/**
 * src/components/map/layers/WaveFrontLayer.ts
 * ============================================
 * Deck.gl PolygonLayer / PathLayer rendering Ground Truth P/S wave circles
 * and EEW System Estimated P/S wave circles.
 */

import { CompositeLayer, type DefaultProps, type Layer } from '@deck.gl/core';
import { PathLayer } from '@deck.gl/layers';
import { EEWReport, EarthquakeHypocenter } from '../../../core/types';

export type WaveFrontLayerProps = {
  id?: string;
  trueHypocenter: EarthquakeHypocenter;
  currentTime?: number;
  pRadiusKm?: number;
  sRadiusKm?: number;
  eewReport?: EEWReport | null;
  pointsPerRing?: number;
  [key: string]: unknown;
};

export interface WaveRingData {
  path: [number, number][];
}

interface WaveRingSpec {
  subId: string;
  centerLat: number;
  centerLon: number;
  radiusKm: number;
  color: [number, number, number, number];
  width: number;
  minPixelWidth: number;
}

const EARTH_RADIUS_KM = 6371.0088;
const DEFAULT_VP_KMS = 6.0;
const DEFAULT_VS_KMS = 3.5;
const DEFAULT_POINTS_PER_RING = 64;

/**
 * Normalizes longitude to [-180, 180] degrees.
 */
export function normalizeLongitude(lon: number): number {
  let l = (lon + 180) % 360;
  if (l < 0) l += 360;
  const normalized = l - 180;
  return normalized === -180 && lon > 0 ? 180 : normalized;
}

/**
 * Calculates the surface propagation radius (in km) of a seismic spherical wavefront.
 *
 * In 3D space, a seismic wave propagates spherically from the hypocenter at depth d:
 *   R_3d(t) = v * delta_t
 * When projected onto the Earth's surface (z = 0):
 *   R_3d^2 = r_surface^2 + d^2
 *
 * Therefore:
 * - If R_3d <= d: The wavefront has not yet reached the Earth's surface; r_surface = 0.
 * - If R_3d > d:  r_surface = sqrt(R_3d^2 - d^2)
 */
export function calculateSurfaceWaveRadius(
  elapsedTimeSec: number,
  depthKm: number,
  velocityKmS: number
): number {
  if (elapsedTimeSec <= 0) return 0;
  const dist3d = velocityKmS * elapsedTimeSec;
  if (dist3d <= depthKm) return 0;
  return Math.sqrt(dist3d * dist3d - depthKm * depthKm);
}

/**
 * Generates geodesic circular path coordinates (array of paths, each being [lon, lat][]).
 * Returns multiple paths if the circle crosses the International Date Line (±180° longitude)
 * to prevent screen-tearing rendering glitches.
 */
export function generateGeodesicCirclePaths(
  centerLat: number,
  centerLon: number,
  radiusKm: number,
  points: number = DEFAULT_POINTS_PER_RING
): [number, number][][] {
  if (radiusKm <= 0.1) return [];

  const rawPoints: [number, number][] = [];
  const radLat = centerLat * (Math.PI / 180.0);
  const radLon = centerLon * (Math.PI / 180.0);
  const dR = radiusKm / EARTH_RADIUS_KM;

  for (let i = 0; i <= points; i++) {
    const bearing = (i * 2.0 * Math.PI) / points;

    const lat = Math.asin(
      Math.sin(radLat) * Math.cos(dR) +
      Math.cos(radLat) * Math.sin(dR) * Math.cos(bearing)
    );

    const lon =
      radLon +
      Math.atan2(
        Math.sin(bearing) * Math.sin(dR) * Math.cos(radLat),
        Math.cos(dR) - Math.sin(radLat) * Math.sin(lat)
      );

    const degLat = lat * (180.0 / Math.PI);
    const degLon = normalizeLongitude(lon * (180.0 / Math.PI));

    rawPoints.push([degLon, degLat]);
  }

  // Segment generation splitting across the International Date Line (±180° lon)
  const segments: [number, number][][] = [];
  let currentSegment: [number, number][] = [rawPoints[0]];

  for (let i = 1; i < rawPoints.length; i++) {
    const prev = rawPoints[i - 1];
    const curr = rawPoints[i];
    const lonDiff = curr[0] - prev[0];

    if (Math.abs(lonDiff) > 180) {
      if (prev[0] > 0 && curr[0] < 0) {
        // East to West crossing (+180° / -180°)
        const unwrapCurrLon = curr[0] + 360;
        const t = (180 - prev[0]) / (unwrapCurrLon - prev[0]);
        const crossLat = prev[1] + t * (curr[1] - prev[1]);

        currentSegment.push([180, crossLat]);
        segments.push(currentSegment);
        currentSegment = [[-180, crossLat], curr];
      } else if (prev[0] < 0 && curr[0] > 0) {
        // West to East crossing (-180° / +180°)
        const unwrapCurrLon = curr[0] - 360;
        const t = (-180 - prev[0]) / (unwrapCurrLon - prev[0]);
        const crossLat = prev[1] + t * (curr[1] - prev[1]);

        currentSegment.push([-180, crossLat]);
        segments.push(currentSegment);
        currentSegment = [[180, crossLat], curr];
      } else {
        segments.push(currentSegment);
        currentSegment = [curr];
      }
    } else {
      currentSegment.push(curr);
    }
  }

  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  // Merge the last segment with the first segment if they connect at index 0
  if (segments.length > 1) {
    const firstSeg = segments[0];
    const lastSeg = segments[segments.length - 1];
    const startPt = firstSeg[0];
    const endPt = lastSeg[lastSeg.length - 1];

    if (Math.abs(startPt[0] - endPt[0]) < 1e-4 && Math.abs(startPt[1] - endPt[1]) < 1e-4) {
      const merged = lastSeg.concat(firstSeg.slice(1));
      segments.splice(segments.length - 1, 1);
      segments[0] = merged;
    }
  }

  return segments;
}

/**
 * Generates single-path geodesic circle coordinates (backward compatibility).
 */
export function generateGeodesicCircle(
  centerLat: number,
  centerLon: number,
  radiusKm: number,
  points: number = DEFAULT_POINTS_PER_RING
): [number, number][] {
  const paths = generateGeodesicCirclePaths(centerLat, centerLon, radiusKm, points);
  return paths[0] ?? [];
}

const defaultProps: DefaultProps<WaveFrontLayerProps> = {
  pointsPerRing: DEFAULT_POINTS_PER_RING
};

export class WaveFrontLayer extends CompositeLayer<WaveFrontLayerProps> {
  static override layerName = 'WaveFrontLayer';
  static override defaultProps = defaultProps;

  override renderLayers(): Layer[] {
    const {
      trueHypocenter,
      currentTime,
      pRadiusKm,
      sRadiusKm,
      eewReport,
      pointsPerRing = DEFAULT_POINTS_PER_RING
    } = this.props;

    // 1. Calculate Ground Truth surface wave radii
    let truePRadius = 0;
    let trueSRadius = 0;

    if (currentTime !== undefined) {
      const elapsedTrue = Math.max(0.0, currentTime - trueHypocenter.originTime);
      truePRadius = calculateSurfaceWaveRadius(elapsedTrue, trueHypocenter.depth, DEFAULT_VP_KMS);
      trueSRadius = calculateSurfaceWaveRadius(elapsedTrue, trueHypocenter.depth, DEFAULT_VS_KMS);
    } else {
      truePRadius = pRadiusKm ?? 0;
      trueSRadius = sRadiusKm ?? 0;
    }

    // 2. Build wave specifications (DRY pattern)
    const rings: WaveRingSpec[] = [];

    // Ground truth P-Wave ring
    if (truePRadius > 0.1) {
      rings.push({
        subId: 'true-p',
        centerLat: trueHypocenter.lat,
        centerLon: trueHypocenter.lon,
        radiusKm: truePRadius,
        color: [0, 242, 254, 220], // Bright cyan
        width: 3,
        minPixelWidth: 2
      });
    }

    // Ground truth S-Wave ring
    if (trueSRadius > 0.1) {
      rings.push({
        subId: 'true-s',
        centerLat: trueHypocenter.lat,
        centerLon: trueHypocenter.lon,
        radiusKm: trueSRadius,
        color: [255, 8, 68, 255], // Bright crimson
        width: 4,
        minPixelWidth: 3
      });
    }

    // 3. EEW Estimated Wave Front Rings
    if (eewReport?.estimatedHypocenter) {
      const estHypo = eewReport.estimatedHypocenter;
      let estElapsedTime = 0;

      if (currentTime !== undefined) {
        estElapsedTime = Math.max(0.0, currentTime - estHypo.originTime);
      } else {
        // Fallback approximation when external currentTime is omitted:
        // Convert surface radius back to 3D distance R = sqrt(r^2 + d^2)
        const rTrue3d = Math.sqrt(truePRadius * truePRadius + trueHypocenter.depth * trueHypocenter.depth);
        const approxCurrentTime = trueHypocenter.originTime + rTrue3d / DEFAULT_VP_KMS;
        estElapsedTime = Math.max(0.0, approxCurrentTime - estHypo.originTime);
      }

      const estPRadius = calculateSurfaceWaveRadius(estElapsedTime, estHypo.depth, DEFAULT_VP_KMS);
      const estSRadius = calculateSurfaceWaveRadius(estElapsedTime, estHypo.depth, DEFAULT_VS_KMS);

      if (estPRadius > 0.1) {
        rings.push({
          subId: 'est-p',
          centerLat: estHypo.lat,
          centerLon: estHypo.lon,
          radiusKm: estPRadius,
          color: [114, 239, 221, 240], // Neon aqua
          width: 2,
          minPixelWidth: 2
        });
      }

      if (estSRadius > 0.1) {
        rings.push({
          subId: 'est-s',
          centerLat: estHypo.lat,
          centerLon: estHypo.lon,
          radiusKm: estSRadius,
          color: [255, 158, 0, 240], // Neon orange
          width: 3,
          minPixelWidth: 2
        });
      }
    }

    // 4. Render all active rings with PathLayer (DRY principle applied)
    const sublayers: Layer[] = [];

    for (const spec of rings) {
      const paths = generateGeodesicCirclePaths(
        spec.centerLat,
        spec.centerLon,
        spec.radiusKm,
        pointsPerRing
      );
      if (paths.length === 0) continue;

      const data: WaveRingData[] = paths.map((p) => ({ path: p }));

      sublayers.push(
        new PathLayer<WaveRingData>({
          id: `${this.props.id}-${spec.subId}`,
          data,
          getPath: (d: WaveRingData) => d.path,
          getColor: spec.color,
          getWidth: spec.width,
          widthUnits: 'pixels',
          widthMinPixels: spec.minPixelWidth,
          jointRounded: true,
          capRounded: true,
          pickable: false,
          wrapLongitude: true
        })
      );
    }

    return sublayers;
  }
}

/**
 * Backward compatibility wrapper returning Layer[] containing WaveFrontLayer.
 */
export function createWaveFrontLayers(props: WaveFrontLayerProps): Layer[] {
  const { id = 'wavefront' } = props;
  return [new WaveFrontLayer({ ...props, id })];
}
