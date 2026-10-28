/**
 * Long-Period Ground Motion (LPGM) response-spectrum calculation.
 */

import { EarthquakeHypocenter } from '../types';
import { calculateBedrockPgv } from './attenuation';
import { calculateSurfacePgv } from './siteResponse';
import { Slab2Model } from './slabModel';

const DAMPING_RATIO = 0.05;
const SAMPLE_INTERVAL_SEC = 0.05;
const EARTH_RADIUS_KM = 6371;
let syntheticResponseFactor: number | undefined;

export interface LPGMResponseSpectrumPoint {
  periodSec: number;
  absoluteVelocityResponse: number;
}

export interface LPGMResult {
  sv: number;
  classLevel: 1 | 2 | 3 | 4 | 0;
}

/**
 * Computes 5%-damped absolute velocity response over the JMA LPGM period band.
 * The input acceleration is ground acceleration in cm/s².
 */
export function calculateLPGMResponseSpectrum(
  groundAcceleration: ArrayLike<number>,
  dt: number
): LPGMResponseSpectrumPoint[] {
  if (!Number.isFinite(dt) || dt <= 0) {
    throw new Error(`Invalid sampling interval dt: ${dt}. Must be a finite positive number.`);
  }
  if (groundAcceleration.length === 0) {
    throw new Error('Ground acceleration waveform must not be empty.');
  }
  for (let i = 0; i < groundAcceleration.length; i++) {
    if (!Number.isFinite(groundAcceleration[i])) {
      throw new Error(`Invalid ground acceleration sample at index ${i}.`);
    }
  }

  const spectrum: LPGMResponseSpectrumPoint[] = [];
  for (let step = 0; step <= 31; step++) {
    const periodSec = Math.round((1.6 + step * 0.2) * 10) / 10;
    const omega = 2 * Math.PI / periodSec;
    const mass = 1;
    const damping = 2 * DAMPING_RATIO * omega * mass;
    const stiffness = omega * omega * mass;
    const beta = 0.25;
    const gamma = 0.5;
    const inverseBetaDtSquared = 1 / (beta * dt * dt);
    const effectiveStiffness =
      stiffness + gamma / (beta * dt) * damping + mass * inverseBetaDtSquared;

    let displacement = 0;
    let relativeVelocity = 0;
    let relativeAcceleration = -groundAcceleration[0];
    let groundVelocity = 0;
    let peakAbsoluteVelocity = 0;

    for (let i = 0; i < groundAcceleration.length - 1; i++) {
      const nextGroundAcceleration = groundAcceleration[i + 1];
      const effectiveForce =
        -nextGroundAcceleration +
        mass * (
          displacement * inverseBetaDtSquared +
          relativeVelocity / (beta * dt) +
          (1 / (2 * beta) - 1) * relativeAcceleration
        ) +
        damping * (
          gamma / (beta * dt) * displacement +
          (gamma / beta - 1) * relativeVelocity +
          dt * (gamma / (2 * beta) - 1) * relativeAcceleration
        );
      const nextDisplacement = effectiveForce / effectiveStiffness;
      const nextRelativeAcceleration =
        (nextDisplacement - displacement) * inverseBetaDtSquared -
        relativeVelocity / (beta * dt) -
        (1 / (2 * beta) - 1) * relativeAcceleration;
      const nextRelativeVelocity =
        relativeVelocity +
        dt * ((1 - gamma) * relativeAcceleration + gamma * nextRelativeAcceleration);

      groundVelocity += 0.5 * (groundAcceleration[i] + nextGroundAcceleration) * dt;
      peakAbsoluteVelocity = Math.max(
        peakAbsoluteVelocity,
        Math.abs(nextRelativeVelocity + groundVelocity)
      );

      displacement = nextDisplacement;
      relativeVelocity = nextRelativeVelocity;
      relativeAcceleration = nextRelativeAcceleration;
    }

    spectrum.push({
      periodSec,
      absoluteVelocityResponse: peakAbsoluteVelocity
    });
  }

  return spectrum;
}

export function classifyLPGM(maxAbsoluteVelocityResponse: number): LPGMResult['classLevel'] {
  if (!Number.isFinite(maxAbsoluteVelocityResponse) || maxAbsoluteVelocityResponse < 5) return 0;
  if (maxAbsoluteVelocityResponse >= 100) return 4;
  if (maxAbsoluteVelocityResponse >= 50) return 3;
  if (maxAbsoluteVelocityResponse >= 15) return 2;
  return 1;
}

export function calculateLPGMFromWaveform(
  groundAcceleration: ArrayLike<number>,
  dt: number
): LPGMResult {
  const spectrum = calculateLPGMResponseSpectrum(groundAcceleration, dt);
  const sv = spectrum.reduce(
    (maximum, point) => Math.max(maximum, point.absoluteVelocityResponse),
    0
  );
  return { sv, classLevel: classifyLPGM(sv) };
}

/**
 * Estimates LPGM for the simulator when no station waveform is available.
 * It derives a synthetic surface record from the existing PGV attenuation model,
 * then runs the same response-spectrum calculation used for observed waveforms.
 */
export function estimateLPGM(
  hypo: EarthquakeHypocenter,
  lat: number,
  lon: number,
  surfaceAmplification = 1,
  slabModel?: Slab2Model
): LPGMResult {
  if (hypo.magnitude < 6.5 || hypo.depth > 100) {
    return { sv: 0, classLevel: 0 };
  }

  const epicentralDistance = calculateDistance(hypo.lat, hypo.lon, lat, lon);
  const faultDistance = Math.hypot(epicentralDistance, hypo.depth);
  const bedrockPgv = calculateBedrockPgv(
    faultDistance,
    hypo.depth,
    hypo.magnitude,
    hypo.lat,
    hypo.lon,
    lat,
    lon,
    slabModel
  );
  const surfacePgv = calculateSurfacePgv(bedrockPgv, surfaceAmplification);
  const sv = surfacePgv * getSyntheticResponseFactor();
  return { sv, classLevel: classifyLPGM(sv) };
}

function getSyntheticResponseFactor(): number {
  if (syntheticResponseFactor !== undefined) return syntheticResponseFactor;
  syntheticResponseFactor = calculateLPGMFromWaveform(
    createSyntheticGroundAcceleration(),
    SAMPLE_INTERVAL_SEC
  ).sv;
  return syntheticResponseFactor;
}

function createSyntheticGroundAcceleration(): Float64Array {
  const durationSec = 40;
  const sampleCount = Math.round(durationSec / SAMPLE_INTERVAL_SEC) + 1;
  const velocity = new Float64Array(sampleCount);
  let peakVelocity = 0;

  for (let i = 0; i < sampleCount; i++) {
    const time = i * SAMPLE_INTERVAL_SEC;
    const remaining = durationSec - time;
    const envelope =
      (1 - Math.exp(-time / 1.5)) *
      Math.exp(-time / 18) *
      (1 - Math.exp(-remaining / 2));
    velocity[i] = envelope * (
      Math.sin(2 * Math.PI * time / 3.2) +
      0.6 * Math.sin(2 * Math.PI * time / 5.2 + 0.7) +
      0.35 * Math.sin(2 * Math.PI * time / 7.2 + 1.4)
    );
    peakVelocity = Math.max(peakVelocity, Math.abs(velocity[i]));
  }

  const scale = peakVelocity > 0 ? 1 / peakVelocity : 0;
  const acceleration = new Float64Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const previous = velocity[Math.max(0, i - 1)];
    const next = velocity[Math.min(sampleCount - 1, i + 1)];
    const divisor = i === 0 || i === sampleCount - 1 ? SAMPLE_INTERVAL_SEC : 2 * SAMPLE_INTERVAL_SEC;
    acceleration[i] = ((next - previous) / divisor) * scale;
  }
  return acceleration;
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRadians = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRadians;
  const dLon = (lon2 - lon1) * toRadians;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRadians) * Math.cos(lat2 * toRadians) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
