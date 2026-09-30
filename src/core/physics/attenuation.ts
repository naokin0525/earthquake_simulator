/**
 * src/core/physics/attenuation.ts
 * ================================
 * Implementation of the Si & Midorikawa (1999) Peak Ground Velocity (PGV) attenuation model
 * and JMA Seismic Intensity scale conversion.
 */

import { JmaIntensityScale } from '../types';

const BASE_K_ATTENUATION = 0.002; // Standard inelastic attenuation coefficient (km^-1)

/**
 * Calculates Peak Ground Velocity on engineering bedrock (PGV_600, in cm/s)
 * using the Si & Midorikawa (1999) empirical attenuation model.
 *
 * Formula:
 *   log10(PGV_600) = 0.58 * Mw + 0.0038 * D - 1.29 - log10(R + 0.0028 * 10^(0.50 * Mw)) - k_eff * R
 *
 * @param R Hypocentral distance in kilometers (km)
 * @param D Hypocentral depth in kilometers (km)
 * @param Mw Moment magnitude
 * @param rSlab Raypath fraction inside cold subducting slab [0.0, 1.0]
 */
export function calculateBedrockPgv(
  R: number,
  D: number,
  Mw: number,
  rSlab: number = 0.0
): number {
  const rClamped = Math.max(0.0, Math.min(1.0, rSlab));
  
  // Attenuation coefficient reduced inside cold high-Q subducting slab
  const kEff = BASE_K_ATTENUATION * (1.0 - 0.75 * rClamped);

  const saturationTerm = 0.0028 * Math.pow(10.0, 0.50 * Mw);
  const log10Pgv600 =
    0.58 * Mw +
    0.0038 * D -
    1.29 -
    Math.log10(R + saturationTerm) -
    kEff * R;

  return Math.pow(10.0, log10Pgv600);
}

/**
 * Calculates Surface Peak Ground Velocity (PGV_surface, in cm/s) given site ARV.
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
  R: number,
  D: number,
  Mw: number,
  arv: number,
  rSlab: number = 0.0
): { pgvSurface: number; continuousIntensity: number; jmaScale: JmaIntensityScale } {
  const bedrockPgv = calculateBedrockPgv(R, D, Mw, rSlab);
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
