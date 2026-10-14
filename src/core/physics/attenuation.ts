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

export type FaultType = 'crustal' | 'interplate' | 'intraplate';

// Deprecated heuristic based solely on rSlab. Use depth-based fault type determination in calculateJmaIntensity.
export function resolveFaultType(rSlab: number = 0.0): FaultType {
  // Retain backward compatibility: if slab fraction suggests deep slab, treat as intraplate
  if (rSlab > 0.5) return 'intraplate';
  return 'crustal';
}

/**
 * Calculates Peak Ground Velocity on engineering bedrock (PGV_600, in cm/s)
 * using the Si & Midorikawa (1999) empirical attenuation model.
 *
 * IMPORTANT:
 *   - R is the closest distance to the fault plane, not hypocentral distance.
 *   - D is the average depth of the fault plane, not the hypocenter depth.
 *   - The published model includes fault-type dummy terms: crustal = 0.00, inter-plate = -0.02,
 *     intraplate/slab = +0.12. The attenuation coefficient k remains the baseline 0.002 and is
 *     not modified by slab fraction.
 *
 * Formula:
 *   log10(PGV_600) =
 *     0.58 * Mw + 0.0038 * D + dummyTerm - 1.29 - log10(R + 0.0028 * 10^(0.50 * Mw)) - k * R
 *
 * @param faultDistanceKm Closest distance to the fault plane in km.
 * @param faultDepthKm Average fault-plane depth in km.
 * @param Mw Moment magnitude.
 * @param rSlab Raypath fraction inside cold slab; used only as a fallback signal for intraplate events.
 * @param faultType Fault type for the published dummy-term correction.
 */
export function calculateBedrockPgv(
  faultDistanceKm: number,
  faultDepthKm: number,
  Mw: number,
  rSlab: number = 0.0,
  faultType: FaultType = resolveFaultType(rSlab)
): number {
  const clampedDistance = Math.max(0.0, faultDistanceKm);
  const clampedDepth = Math.max(0.0, faultDepthKm);
  const safeMw = Math.max(0.0, Mw);

  // The paper's dummy terms are additive offsets in log-space, not distance-dependent k changes.
  // Intraplate/slab events are stronger by +0.12 in log10(PGV), while interplate events are weaker by -0.02.
  const faultTypeOffset =
    faultType === 'intraplate' ? 0.12 :
    faultType === 'interplate' ? -0.02 :
    0.0;

  // This is the published Si & Midorikawa bedrock attenuation form.
  const saturationTerm = 0.0028 * Math.pow(10.0, 0.50 * safeMw);
  const log10Pgv600 =
    0.58 * safeMw +
    0.0038 * clampedDepth +
    faultTypeOffset -
    1.29 -
    Math.log10(clampedDistance + saturationTerm) -
    BASE_K_ATTENUATION * clampedDistance;

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
  faultType: FaultType = resolveFaultType(rSlab)
): { pgvSurface: number; continuousIntensity: number; jmaScale: JmaIntensityScale } {
  // Determine fault type based on depth heuristic (crustal <30km, interplate 30-60km, intraplate >60km)
  const depthBasedFaultType: FaultType =
    faultDepthKm < 30 ? 'crustal' :
    faultDepthKm < 60 ? 'interplate' :
    'intraplate';
  const bedrockPgv = calculateBedrockPgv(faultDistanceKm, faultDepthKm, Mw, rSlab, depthBasedFaultType);
  const pgvSurface = calculateSurfacePgv(bedrockPgv, arv);
  const continuousIntensity = calculateContinuousJmaIntensity(pgvSurface);
  const jmaScale = quantizeJmaIntensity(continuousIntensity);

  return {
    pgvSurface,
    continuousIntensity,
    jmaScale
  };
}
