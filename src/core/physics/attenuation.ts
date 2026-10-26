/**
 * src/core/physics/attenuation.ts
 * ================================
 * Implementation of the Si & Midorikawa (1999) Peak Ground Velocity (PGV) attenuation model,
 * temporal envelope coda decay, and empirical predicted intensity equivalents.
 *
 * Responsibilities:
 * - Attenuation relations for ground motion (PGV, PGA)
 * - Temporal envelope simulation
 * - Backward-compatible re-exports for site amplification and intensity conversion
 */

import { JmaIntensityScale } from '../types';
import {
  calculateArvFromVs30,
  calculateSurfacePgv,
  calculateSurfacePga
} from './siteResponse';
import {
  toJmaIntensityScale,
  quantizeJmaIntensity,
  jmaScaleToNumeric,
  isJmaGreaterOrEqual
} from './intensity';

// Re-export site response functions for backward compatibility
export { calculateArvFromVs30, calculateSurfacePgv, calculateSurfacePga };

// Re-export intensity quantization and comparison utilities for backward compatibility
export { toJmaIntensityScale, quantizeJmaIntensity, jmaScaleToNumeric, isJmaGreaterOrEqual };

const BASE_K_ATTENUATION = 0.002; // Standard inelastic attenuation coefficient (km^-1)
const EARTH_RADIUS_KM = 6371.0088;

// Definition points for the Japan and Kuril trench axes (based on Earthquake Research Committee 2002).
export const PACIFIC_TRENCH_AXIS_POINTS: Array<[number, number]> = [
  [45.0, 150.0],
  [43.0, 146.0],
  [41.5, 144.5],
  [40.0, 144.0],
  [38.0, 143.5],
  [36.0, 142.5],
  [34.5, 141.5]
];

export type FaultType = 'crustal' | 'interplate' | 'intraplate';

// Deprecated heuristic based solely on rSlab. Prefer depth-based event classification.
export function resolveFaultType(rSlab: number = 0.0): FaultType {
  // Retain backward compatibility: if slab fraction suggests deep slab, treat as intraplate
  if (rSlab > 0.5) return 'intraplate';
  return 'crustal';
}

/**
 * Fallback event classification for the point-source simulator. Production
 * finite-fault inputs should provide the fault type explicitly instead.
 */
export function inferFaultTypeFromDepth(depthKm: number): FaultType {
  if (depthKm >= 60) return 'intraplate';
  if (depthKm >= 30) return 'interplate';
  return 'crustal';
}

/**
 * Calculates the shortest local-projection distance from a point to the trench
 * axis polyline. The equirectangular projection is accurate at the scale of
 * these short trench segments and avoids allocating geodesic helper objects.
 */
export function calculateTrenchAxisDistanceKm(
  stationLat: number,
  stationLon: number,
  trenchAxisPoints: Array<[number, number]> = PACIFIC_TRENCH_AXIS_POINTS
): number {
  if (trenchAxisPoints.length === 0) return Number.POSITIVE_INFINITY;

  const latitudeRadians = stationLat * Math.PI / 180.0;
  const longitudeScale = EARTH_RADIUS_KM * Math.cos(latitudeRadians) * Math.PI / 180.0;
  const latitudeScale = EARTH_RADIUS_KM * Math.PI / 180.0;
  const firstPoint = trenchAxisPoints[0];
  if (trenchAxisPoints.length === 1) {
    return Math.hypot(
      (firstPoint[1] - stationLon) * longitudeScale,
      (firstPoint[0] - stationLat) * latitudeScale
    );
  }

  let shortestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < trenchAxisPoints.length - 1; i++) {
    const start = trenchAxisPoints[i];
    const end = trenchAxisPoints[i + 1];
    const startX = (start[1] - stationLon) * longitudeScale;
    const startY = (start[0] - stationLat) * latitudeScale;
    const segmentX = (end[1] - start[1]) * longitudeScale;
    const segmentY = (end[0] - start[0]) * latitudeScale;
    const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
    const projection = segmentLengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, -(startX * segmentX + startY * segmentY) / segmentLengthSquared));
    const nearestX = startX + projection * segmentX;
    const nearestY = startY + projection * segmentY;
    shortestDistance = Math.min(shortestDistance, Math.hypot(nearestX, nearestY));
  }

  return shortestDistance;
}

export function calculateMorikawaCorrectionTerms(
  faultDistanceKm: number,
  faultDepthKm: number,
  rTrKm: number
): { log10V1: number; log10V2: number } {
  const log10V1 = faultDepthKm > 30.0 && Number.isFinite(rTrKm)
    ? (-4.0e-5 * rTrKm + 9.9e-3) * (faultDepthKm - 30.0)
    : 0.0;
  const log10V2 = faultDistanceKm > 300.0
    ? Math.max(0.0, 2.1 * Math.log10(faultDistanceKm / 300.0) - 0.01)
    : 0.0;

  return { log10V1, log10V2 };
}

/**
 * Calculates Peak Ground Velocity on engineering bedrock (PGV_600, in cm/s)
 * using the Si & Midorikawa (1999) empirical attenuation model.
 *
 * IMPORTANT:
 *   - R is the closest distance to the fault plane, not hypocentral distance.
 *   - D is the average depth of the fault plane, not the hypocenter depth.
 *   - The published model includes fault-type dummy terms: crustal = 0.00, inter-plate = -0.02,
 *     intraplate/slab = +0.12.
 *
 * Formula:
 *   log10(PGV_600) =
 *     0.58 * Mw + 0.0038 * D + dummyTerm - 1.29
 *       - log10(R + 0.0028 * 10^(0.50 * Mw)) - k * R + log10(V1) + log10(V2)
 *
 * @param faultDistanceKm Closest distance to the fault plane in km.
 * @param faultDepthKm Average fault-plane depth in km.
 * @param Mw Moment magnitude.
 * @param rSlab Retained for API compatibility; slab path boost is not part of this attenuation model.
 * @param faultType Fault type for the published dummy-term correction.
 * @param stationLat Observation point latitude, used to calculate trench distance when rTrKm is omitted.
 * @param stationLon Observation point longitude, used to calculate trench distance when rTrKm is omitted.
 * @param rTrKm Optional precomputed shortest distance to the trench axis.
 */
export function calculateBedrockPgv(
  faultDistanceKm: number,
  faultDepthKm: number,
  Mw: number,
  rSlab: number = 0.0,
  faultType?: FaultType,
  stationLat?: number,
  stationLon?: number,
  rTrKm?: number
): number {
  const clampedDistance = Math.max(0.0, faultDistanceKm);
  const clampedDepth = Math.max(0.0, faultDepthKm);
  const safeMw = Math.max(0.0, Mw);

  const resolvedFaultType = faultType ?? inferFaultTypeFromDepth(clampedDepth);
  const faultTypeOffset =
    resolvedFaultType === 'intraplate' ? 0.12 :
    resolvedFaultType === 'interplate' ? -0.02 :
    0.0;
  const trenchDistance = rTrKm ??
    (stationLat !== undefined && stationLon !== undefined
      ? calculateTrenchAxisDistanceKm(stationLat, stationLon)
      : Number.NaN);
  const { log10V1, log10V2 } = calculateMorikawaCorrectionTerms(
    clampedDistance,
    clampedDepth,
    trenchDistance
  );
  void rSlab;

  const saturationTerm = 0.0028 * Math.pow(10.0, 0.50 * safeMw);
  const log10Pgv600 =
    0.58 * safeMw +
    0.0038 * clampedDepth +
    faultTypeOffset -
    1.29 -
    Math.log10(clampedDistance + saturationTerm) -
    BASE_K_ATTENUATION * clampedDistance +
    log10V1 +
    log10V2;

  return Math.pow(10.0, log10Pgv600);
}

const TAU_BASE = 4.0; // Base coda decay time constant (seconds)

/**
 * Calculates temporal envelope multiplier for PGV wave propagation and coda decay.
 * P phase: ~15% of peak, ramping linearly from P arrival to S arrival
 * S phase: smooth rise to peak, followed by exponential coda decay
 */
export function envelope(t: number, pObs: number, sArr: number, Mw: number, peakPgv: number): number {
  if (t < pObs) return 0;
  const rise = Math.max(0.5, sArr - pObs);
  if (t < sArr) return peakPgv * 0.15 * ((t - pObs) / rise);
  const tPeak = sArr + 2.5;
  const tau = TAU_BASE + Mw * 1.5; // Bigger quakes ring longer
  if (t < tPeak) {
    const x = (t - sArr) / (tPeak - sArr);
    return peakPgv * (0.15 + 0.85 * x * x);
  }
  return peakPgv * Math.exp(-(t - tPeak) / tau);
}

/**
 * Converts surface PGV (cm/s) to predicted continuous JMA Seismic Intensity equivalent (I).
 * Empirical Formula: I = 2.68 + 1.72 * log10(PGV_surface)
 *
 * NOTE: This is an empirical prediction formula derived from PGV attenuation models,
 * distinct from the official instrumental seismic intensity (計測震度) calculated
 * from filtered 3-component acceleration waveforms.
 */
export function calculateContinuousJmaIntensity(pgvSurface: number): number {
  if (pgvSurface <= 1e-6) return -3.0;
  return 2.68 + 1.72 * Math.log10(pgvSurface);
}

/**
 * Full helper function to calculate predicted discrete JMA intensity directly from source parameters
 * using the Si & Midorikawa attenuation model.
 */
export function calculateJmaIntensity(
  faultDistanceKm: number,
  faultDepthKm: number,
  Mw: number,
  arv: number,
  rSlab: number = 0.0,
  faultType?: FaultType,
  stationLat?: number,
  stationLon?: number,
  rTrKm?: number
): {
  pgvSurface: number;
  continuousIntensity: number;
  jmaScale: JmaIntensityScale;
  log10V1: number;
  log10V2: number;
} {
  // Determine fault type based on depth heuristic (crustal <30km, interplate 30-60km, intraplate >60km)
  const resolvedFaultType = faultType ?? inferFaultTypeFromDepth(faultDepthKm);
  const trenchDistance = rTrKm ??
    (stationLat !== undefined && stationLon !== undefined
      ? calculateTrenchAxisDistanceKm(stationLat, stationLon)
      : Number.NaN);
  const { log10V1, log10V2 } = calculateMorikawaCorrectionTerms(
    Math.max(0.0, faultDistanceKm),
    Math.max(0.0, faultDepthKm),
    trenchDistance
  );
  const bedrockPgv = calculateBedrockPgv(
    faultDistanceKm,
    faultDepthKm,
    Mw,
    rSlab,
    resolvedFaultType,
    stationLat,
    stationLon,
    trenchDistance
  );
  const pgvSurface = calculateSurfacePgv(bedrockPgv, arv);
  const continuousIntensity = calculateContinuousJmaIntensity(pgvSurface);
  const jmaScale = quantizeJmaIntensity(continuousIntensity);

  return {
    pgvSurface,
    continuousIntensity,
    jmaScale,
    log10V1,
    log10V2
  };
}
