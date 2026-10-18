/**
 * src/core/physics/siteResponse.ts
 * ================================
 * Estimation of site amplification based on ground surface conditions (AVS30 / ARV).
 */

/**
 * Calculates Amplification factor for Peak Ground Velocity (ARV) from average shear-wave velocity in the top 30m (AVS30).
 * Table 6 / Equation (4) empirical relation (Midorikawa et al.):
 *   log10(ARV) = 1.83 - 0.66 * log10(AVS30)
 * At AVS30 = 600 m/s (engineering bedrock baseline), ARV is approximately 1.0.
 *
 * @param avs30 Average shear-wave velocity in the top 30 meters (m/s).
 * @returns Amplification factor relative to engineering bedrock.
 */
export function calculateArvFromVs30(avs30: number): number {
  const safeAvs30 = Math.max(1e-6, avs30);
  return Math.pow(10.0, 1.83 - 0.66 * Math.log10(safeAvs30));
}

/**
 * Calculates Surface Peak Ground Velocity (PGV_surface, in cm/s) given bedrock PGV and site ARV.
 * The model defines ARV as the amplification relative to engineering bedrock.
 *
 * @param bedrockPgv Bedrock PGV (cm/s).
 * @param arv Site amplification factor. Clamped to minimum of 0.5.
 * @returns Surface PGV (cm/s).
 */
export function calculateSurfacePgv(bedrockPgv: number, arv: number): number {
  return bedrockPgv * Math.max(0.5, arv);
}

/**
 * Calculates Surface Peak Ground Acceleration (PGA_surface, in gal = cm/s²) given bedrock PGA and amplification factor.
 *
 * @param bedrockPga Bedrock PGA in gal (cm/s²).
 * @param ampFactor Site amplification factor. Clamped to minimum of 0.5.
 * @returns Surface PGA in gal (cm/s²).
 */
export function calculateSurfacePga(bedrockPga: number, ampFactor: number): number {
  return bedrockPga * Math.max(0.5, ampFactor);
}
