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
import { Slab2Model } from './slabModel';
import { haversineDistance } from './travelTime';
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
const WEDGE_K_ATTENUATION = 0.0055;
const SLAB_K_ATTENUATION = 0.0004;
const CRUST_DEPTH_KM = 30.0;
const GUIDED_PATH_MIN_DEPTH_KM = 60.0;
const DEFAULT_PATH_STEP_KM = 5.0;
const DEPTH_TERM_CRITICAL_KM = 80.0;

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

export interface PathIntegralResult {
  lCrustKm: number;
  lWedgeKm: number;
  lSlabKm: number;
  totalInelasticLoss: number;
}

export function integrateDirectRayPath(
  srcLat: number,
  srcLon: number,
  srcDepthKm: number,
  staLat: number,
  staLon: number,
  slabModel?: Slab2Model,
  stepKm = DEFAULT_PATH_STEP_KM
): PathIntegralResult {
  if (!Number.isFinite(stepKm) || stepKm <= 0) {
    throw new Error(`Invalid path integration step: ${stepKm}. Must be finite and positive.`);
  }

  const sourceDepth = Math.max(0, srcDepthKm);
  const horizontalDistanceKm = haversineDistance(srcLat, srcLon, staLat, staLon);
  const totalDistanceKm = Math.hypot(horizontalDistanceKm, sourceDepth);
  const sampleCount = Math.max(1, Math.ceil(totalDistanceKm / stepKm));
  const segmentLengthKm = totalDistanceKm / sampleCount;
  let lCrustKm = 0;
  let lWedgeKm = 0;
  let lSlabKm = 0;

  for (let sample = 0; sample < sampleCount; sample++) {
    const fraction = (sample + 0.5) / sampleCount;
    const lat = srcLat + (staLat - srcLat) * fraction;
    const lon = srcLon + (staLon - srcLon) * fraction;
    const depthKm = sourceDepth * (1 - fraction);

    if (depthKm <= CRUST_DEPTH_KM) {
      lCrustKm += segmentLengthKm;
    } else if (slabModel?.isInsideSlab(lat, lon, depthKm)) {
      lSlabKm += segmentLengthKm;
    } else {
      lWedgeKm += segmentLengthKm;
    }
  }

  return {
    lCrustKm,
    lWedgeKm,
    lSlabKm,
    totalInelasticLoss:
      lCrustKm * BASE_K_ATTENUATION +
      lWedgeKm * WEDGE_K_ATTENUATION +
      lSlabKm * SLAB_K_ATTENUATION
  };
}

/**
 * Calculates PGV on engineering bedrock with a direct-ray path integral and
 * optional competing slab-guided path. Without full coordinates and Slab2 data,
 * the function retains the homogeneous Si & Midorikawa attenuation equation.
 */
export function calculateBedrockPgv(
  faultDistanceKm: number,
  faultDepthKm: number,
  Mw: number,
  hypoLat?: number,
  hypoLon?: number,
  stationLat?: number,
  stationLon?: number,
  slabModel?: Slab2Model,
  faultType?: FaultType
): number {
  const clampedDistance = Math.max(0.0, faultDistanceKm);
  const clampedDepth = Math.max(0.0, faultDepthKm);
  const safeMw = Math.max(0.0, Mw);
  const resolvedFaultType = faultType ?? inferFaultTypeFromDepth(clampedDepth);
  const faultTypeOffset =
    resolvedFaultType === 'intraplate' ? 0.12 :
    resolvedFaultType === 'interplate' ? -0.02 :
    0.0;
  const sourceDepthTerm = clampedDepth <= DEPTH_TERM_CRITICAL_KM
    ? 0.0038 * clampedDepth
    : 0.0038 * DEPTH_TERM_CRITICAL_KM +
      0.0038 * DEPTH_TERM_CRITICAL_KM *
      Math.log(1 + (clampedDepth - DEPTH_TERM_CRITICAL_KM) / DEPTH_TERM_CRITICAL_KM);
  const saturationTerm = 0.0028 * Math.pow(10.0, 0.50 * safeMw);

  let directTerm =
    -Math.log10(clampedDistance + saturationTerm) -
    BASE_K_ATTENUATION * clampedDistance;
  let guidedTerm = Number.NEGATIVE_INFINITY;
  if (
    hypoLat !== undefined &&
    hypoLon !== undefined &&
    stationLat !== undefined &&
    stationLon !== undefined &&
    slabModel
  ) {
    const directPath = integrateDirectRayPath(
      hypoLat,
      hypoLon,
      clampedDepth,
      stationLat,
      stationLon,
      slabModel
    );
    directTerm =
      -Math.log10(clampedDistance + saturationTerm) -
      directPath.totalInelasticLoss;

    if (clampedDepth >= GUIDED_PATH_MIN_DEPTH_KM) {
      const slabTopDepthKm = slabModel.getTopDepthKm(stationLat, stationLon);
      if (slabTopDepthKm !== null && slabTopDepthKm >= 0) {
        const horizontalDistanceKm = haversineDistance(hypoLat, hypoLon, stationLat, stationLon);
        const guidedSlabLengthKm = Math.hypot(horizontalDistanceKm, clampedDepth - slabTopDepthKm);
        const guidedDistanceKm = guidedSlabLengthKm + slabTopDepthKm;
        const guidedLoss =
          guidedSlabLengthKm * SLAB_K_ATTENUATION +
          slabTopDepthKm * BASE_K_ATTENUATION;
        guidedTerm = -Math.log10(guidedDistanceKm + saturationTerm) - guidedLoss;
      }
    }
  }

  const log10Pgv600 =
    0.58 * safeMw +
    sourceDepthTerm +
    faultTypeOffset -
    1.29 +
    Math.max(directTerm, guidedTerm);

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
  hypoLat?: number,
  hypoLon?: number,
  slabModel?: Slab2Model
): {
  pgvSurface: number;
  continuousIntensity: number;
  jmaScale: JmaIntensityScale;
} {
  void rSlab;
  const resolvedFaultType = faultType ?? inferFaultTypeFromDepth(faultDepthKm);
  const bedrockPgv = calculateBedrockPgv(
    faultDistanceKm,
    faultDepthKm,
    Mw,
    hypoLat,
    hypoLon,
    stationLat,
    stationLon,
    slabModel,
    resolvedFaultType
  );
  const pgvSurface = calculateSurfacePgv(bedrockPgv, arv);
  const continuousIntensity = calculateContinuousJmaIntensity(pgvSurface);
  const jmaScale = quantizeJmaIntensity(continuousIntensity);

  return {
    pgvSurface,
    continuousIntensity,
    jmaScale
  };
}
