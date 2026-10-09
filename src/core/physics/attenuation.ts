/**
 * src/core/physics/attenuation.ts
 * ================================
 * Implementation of the Si & Midorikawa (1999) Peak Ground Velocity (PGV) attenuation model
 * and JMA Seismic Intensity scale conversion.
 */

import { JmaIntensityScale } from '../types';

const BASE_K_ATTENUATION = 0.002; // Standard inelastic attenuation coefficient (km^-1)

export type FaultType = 'crustal' | 'interplate' | 'intraplate';

export function resolveFaultType(rSlab: number = 0.0): FaultType {
  if (rSlab > 0.5) return 'intraplate';
  return 'crustal';
}

export function calculateArvFromVs30(avs30: number): number {
  const safeAvs30 = Math.max(1e-6, avs30);

  // Table 6/Equation (4) relation: log10(ARV) = 1.83 - 0.66 log10(AVS30)
  // At AVS30 = 600 m/s, ARV is approximately 1, which marks the engineering bedrock baseline.
  return Math.pow(10.0, 1.83 - 0.66 * Math.log10(safeAvs30));
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

/**
 * Calculates Surface Peak Ground Velocity (PGV_surface, in cm/s) given site ARV.
 * The model defines ARV as the amplification relative to engineering bedrock, and the published
 * relation is ARV = 10^(1.83 - 0.66 log10(AVS30)).
 */
export function calculateSurfacePgv(bedrockPgv: number, arv: number): number {
  return bedrockPgv * Math.max(0.1, arv);
}

/**
 * Converts surface PGV (cm/s) to continuous JMA Seismic Intensity scale (I).
 * Formula: I = 2.68 + 1.72 * log10(PGV_surface)
 */
export function calculateContinuousJmaIntensity(pgvSurface: number): number {
  if (pgvSurface <= 1e-6) return 0.0;
  const intensity = 2.68 + 1.72 * Math.log10(pgvSurface);
  return Math.max(0.0, intensity);
}

/**
 * Quantizes continuous JMA intensity into the 10 discrete JMA intensity scales.
 */
export function quantizeJmaIntensity(continuousIntensity: number): JmaIntensityScale {
  if (continuousIntensity < 0.5) return '0';
  if (continuousIntensity < 1.5) return '1';
  if (continuousIntensity < 2.5) return '2';
  if (continuousIntensity < 3.5) return '3';
  if (continuousIntensity < 4.5) return '4';
  if (continuousIntensity < 5.0) return '5-';
  if (continuousIntensity < 5.5) return '5+';
  if (continuousIntensity < 6.0) return '6-';
  if (continuousIntensity < 6.5) return '6+';
  return '7';
}

/**
 * Full helper function to calculate discrete JMA intensity directly from parameters.
 */
export function calculateJmaIntensity(
  faultDistanceKm: number,
  faultDepthKm: number,
  Mw: number,
  arv: number,
  rSlab: number = 0.0,
  faultType: FaultType = resolveFaultType(rSlab)
): { pgvSurface: number; continuousIntensity: number; jmaScale: JmaIntensityScale } {
  const bedrockPgv = calculateBedrockPgv(faultDistanceKm, faultDepthKm, Mw, rSlab, faultType);
  const pgvSurface = calculateSurfacePgv(bedrockPgv, arv);
  const continuousIntensity = calculateContinuousJmaIntensity(pgvSurface);
  const jmaScale = quantizeJmaIntensity(continuousIntensity);

  return {
    pgvSurface,
    continuousIntensity,
    jmaScale
  };
}

const JMA_SCALE_ORDER: Record<JmaIntensityScale, number> = {
  '0': 0,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5-': 5,
  '5+': 6,
  '6-': 7,
  '6+': 8,
  '7': 9
};

export function jmaScaleToNumeric(scale: JmaIntensityScale): number {
  return JMA_SCALE_ORDER[scale] ?? 0;
}

export function isJmaGreaterOrEqual(scaleA: JmaIntensityScale, scaleB: JmaIntensityScale): boolean {
  return jmaScaleToNumeric(scaleA) >= jmaScaleToNumeric(scaleB);
}
