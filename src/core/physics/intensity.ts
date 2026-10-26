/**
 * src/core/physics/intensity.ts
 * ==============================
 * JMA Instrumental Seismic Intensity (計測震度) calculation engine.
 *
 * Implements 3-component vector synthesis, duration thresholding (0.3 seconds),
 * official JMA rounding rules, and conversion to discrete JMA intensity scales.
 *
 * Official JMA Formulation:
 * 1. Filtered acceleration vectors: x(t) [NS], y(t) [EW], z(t) [UD] in gal (cm/s²).
 * 2. 3-Component synthesis: a(t) = sqrt(x(t)^2 + y(t)^2 + z(t)^2).
 * 3. Find threshold a0 such that cumulative duration where a(t) >= a0 is 0.3 seconds.
 * 4. Instrumental intensity: I = 2 * log10(a0) + 0.94.
 * 5. Rounding: round 3rd decimal place, truncate 2nd decimal place -> I (1 decimal place).
 * 6. Discrete JMA Scale mapping (0, 1, 2, 3, 4, 5-, 5+, 6-, 6+, 7).
 *
 * Reference:
 *   Japan Meteorological Agency: "計測震度の算出方法"
 *   https://www.data.jma.go.jp/eqev/data/kyoshin/kaisetsu/calc_sindo.html
 */

import { JmaIntensityScale } from '../types';
import { applyJmaIntensityFilter } from './intensityFilter';

export type AccelerationUnit = 'gal' | 'cm/s^2' | 'm/s^2';

export interface ThreeComponentWaveform {
  /** North-South horizontal component */
  ns: ArrayLike<number>;
  /** East-West horizontal component */
  ew: ArrayLike<number>;
  /** Up-Down vertical component */
  ud: ArrayLike<number>;
  /** Sampling interval in seconds (e.g., 0.01 for 100 Hz) */
  dt: number;
  /** Unit of input acceleration waveforms. Defaults to 'gal'. */
  unit?: AccelerationUnit;
}

export interface InstrumentalIntensityResult {
  /** Synthesized filtered 3-component acceleration waveform magnitude (gal) */
  vectorMagnitudeWaveform: Float64Array;
  /** Filtered individual components in gal */
  filtered: {
    ns: Float64Array;
    ew: Float64Array;
    ud: Float64Array;
  };
  /** Threshold acceleration a0 in gal where cumulative duration >= 0.3s */
  thresholdAcceleration: number;
  /** Raw continuous unrounded instrumental intensity: 2 * log10(a0) + 0.94 */
  rawInstrumentalIntensity: number;
  /**
   * Official JMA Instrumental Seismic Intensity:
   * Rounded to 2 decimal places, then truncated to 1 decimal place.
   */
  instrumentalIntensity: number;
  /** Discrete 10-level JMA Intensity Scale ('0' | '1' | '2' | '3' | '4' | '5-' | '5+' | '6-' | '6+' | '7') */
  intensityScale: JmaIntensityScale;
  /** Total duration of waveform in seconds */
  durationSec: number;
}

/**
 * Synthesizes three orthogonal components of acceleration into vector magnitude.
 *   a(t) = sqrt(ns(t)^2 + ew(t)^2 + ud(t)^2)
 *
 * @param ns North-South horizontal component
 * @param ew East-West horizontal component
 * @param ud Up-Down vertical component
 * @returns Vector magnitude time series
 */
export function synthesizeThreeComponents(
  ns: ArrayLike<number>,
  ew: ArrayLike<number>,
  ud: ArrayLike<number>
): Float64Array {
  const n = ns.length;
  if (ew.length !== n || ud.length !== n) {
    throw new Error(
      `Component length mismatch: ns (${n}), ew (${ew.length}), ud (${ud.length}) must all have the same length.`
    );
  }

  const synthesized = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = ns[i];
    const y = ew[i];
    const z = ud[i];
    synthesized[i] = Math.sqrt(x * x + y * y + z * z);
  }
  return synthesized;
}

/**
 * Finds the acceleration threshold a0 where the cumulative duration
 * where waveform magnitude >= a0 is targetDurationSec (default: 0.3 seconds).
 *
 * @param vectorWaveform Synthesized acceleration magnitude time series in gal.
 * @param dt Sampling interval in seconds.
 * @param targetDurationSec Duration threshold in seconds (default: 0.3s).
 * @returns Threshold acceleration in gal.
 */
export function findCumulativeDurationThreshold(
  vectorWaveform: ArrayLike<number>,
  dt: number,
  targetDurationSec = 0.3
): number {
  const n = vectorWaveform.length;
  if (n === 0) {
    throw new Error('Vector waveform must not be empty');
  }
  if (!Number.isFinite(dt) || dt <= 0) {
    throw new Error(`Invalid sampling interval dt: ${dt}. Must be a finite positive number.`);
  }

  const totalDuration = n * dt;
  if (totalDuration < targetDurationSec) {
    throw new Error(
      `Waveform duration (${totalDuration.toFixed(3)}s) is shorter than target duration (${targetDurationSec}s)`
    );
  }

  // Sort magnitudes descending
  const sorted = new Float64Array(vectorWaveform);
  sorted.sort((a, b) => b - a);

  // If all values are zero, threshold is 0.0
  if (sorted[0] <= 0.0) {
    return 0.0;
  }

  // Number of samples corresponding to targetDurationSec
  // At 100 Hz (dt = 0.01), target = 0.3s -> 30 samples.
  // 30 samples are at indices 0..29, so sample 30 is at index 29.
  const rank = targetDurationSec / dt;
  const targetIndex = rank - 1.0;

  if (targetIndex <= 0) {
    return sorted[0];
  }
  if (targetIndex >= n - 1) {
    return sorted[n - 1];
  }

  const idxFloor = Math.floor(targetIndex);
  const idxCeil = Math.ceil(targetIndex);

  if (idxFloor === idxCeil) {
    return sorted[idxFloor];
  }

  // Linear interpolation between surrounding discrete sample ranks
  const frac = targetIndex - idxFloor;
  return sorted[idxFloor] * (1.0 - frac) + sorted[idxCeil] * frac;
}

/**
 * Applies the official JMA rounding rule for instrumental seismic intensity:
 * 1. Round 3rd decimal place (round to 2 decimal places).
 * 2. Truncate 2nd decimal place (truncate to 1 decimal place).
 *
 * Example:
 *   5.1534 -> round 3rd decimal place: 5.15 -> truncate 2nd decimal place: 5.1
 *   5.1260 -> 5.13 -> 5.1
 *   5.1960 -> 5.20 -> 5.2
 *
 * @param raw Continuous instrumental intensity value.
 * @returns Rounded instrumental seismic intensity to 1 decimal place.
 */
export function roundJmaInstrumentalIntensity(raw: number): number {
  if (!Number.isFinite(raw)) return 0.0;
  const sign = raw < 0 ? -1 : 1;
  const abs = Math.abs(raw);
  // Round to 2 decimal places (adding tiny epsilon to prevent standard IEEE 754 float inaccuracies)
  const roundedHundredths = Math.round((abs + 1e-12) * 100);
  // Truncate 2nd decimal place to obtain 1 decimal place
  const truncatedTenths = Math.floor(roundedHundredths / 10) / 10;
  return sign * truncatedTenths;
}

/**
 * Maps instrumental seismic intensity (or continuous intensity) to the official 10-level JMA Intensity Scale.
 *
 * JMA Scale Thresholds:
 *   I < 0.5  -> '0'
 *   I < 1.5  -> '1'
 *   I < 2.5  -> '2'
 *   I < 3.5  -> '3'
 *   I < 4.5  -> '4'
 *   I < 5.0  -> '5-'
 *   I < 5.5  -> '5+'
 *   I < 6.0  -> '6-'
 *   I < 6.5  -> '6+'
 *   I >= 6.5 -> '7'
 *
 * @param instrumentalIntensity Instrumental seismic intensity value.
 * @returns Discrete JMA scale label.
 */
export function toJmaIntensityScale(instrumentalIntensity: number): JmaIntensityScale {
  if (instrumentalIntensity < 0.5) return '0';
  if (instrumentalIntensity < 1.5) return '1';
  if (instrumentalIntensity < 2.5) return '2';
  if (instrumentalIntensity < 3.5) return '3';
  if (instrumentalIntensity < 4.5) return '4';
  if (instrumentalIntensity < 5.0) return '5-';
  if (instrumentalIntensity < 5.5) return '5+';
  if (instrumentalIntensity < 6.0) return '6-';
  if (instrumentalIntensity < 6.5) return '6+';
  return '7';
}

/**
 * Backward compatibility alias for toJmaIntensityScale.
 */
export const quantizeJmaIntensity = toJmaIntensityScale;

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

/**
 * Converts a discrete JMA Intensity Scale to a monotonic integer (0..9) for comparison and sorting.
 */
export function jmaScaleToNumeric(scale: JmaIntensityScale): number {
  return JMA_SCALE_ORDER[scale] ?? 0;
}

/**
 * Compares two JMA Intensity Scales. Returns true if scaleA >= scaleB.
 */
export function isJmaGreaterOrEqual(scaleA: JmaIntensityScale, scaleB: JmaIntensityScale): boolean {
  return jmaScaleToNumeric(scaleA) >= jmaScaleToNumeric(scaleB);
}

/**
 * Formats a discrete JMA Intensity Scale into its standard Japanese display string (e.g., '震度5強').
 */
export function formatJmaIntensityJapanese(scale: JmaIntensityScale): string {
  switch (scale) {
    case '0': return '震度0';
    case '1': return '震度1';
    case '2': return '震度2';
    case '3': return '震度3';
    case '4': return '震度4';
    case '5-': return '震度5弱';
    case '5+': return '震度5強';
    case '6-': return '震度6弱';
    case '6+': return '震度6強';
    case '7': return '震度7';
    default: return `震度${scale}`;
  }
}

/**
 * Computes official JMA Instrumental Seismic Intensity from 3-component acceleration records.
 *
 * @param input 3-component waveform records (ns, ew, ud), sampling interval (dt), and optional unit.
 * @returns Comprehensive instrumental seismic intensity calculation results.
 */
export function calculateInstrumentalIntensity(
  input: ThreeComponentWaveform
): InstrumentalIntensityResult {
  const { ns, ew, ud, dt, unit = 'gal' } = input;

  // Validation
  if (!Number.isFinite(dt) || dt <= 0) {
    throw new Error(`Invalid sampling interval dt: ${dt}. Must be a finite positive number.`);
  }

  const validUnits: readonly AccelerationUnit[] = ['gal', 'cm/s^2', 'm/s^2'];
  if (!validUnits.includes(unit)) {
    throw new Error(`Unsupported unit: "${unit}". Supported units are 'gal', 'cm/s^2', or 'm/s^2'.`);
  }

  if (!ns || !ew || !ud) {
    throw new Error('Waveform components ns, ew, ud must all be defined');
  }

  const n = ns.length;
  if (n === 0) {
    throw new Error('Waveform components must not be empty');
  }
  if (ew.length !== n || ud.length !== n) {
    throw new Error(
      `Component length mismatch: ns (${n}), ew (${ew.length}), ud (${ud.length}) must all have the same length.`
    );
  }

  const durationSec = n * dt;
  if (durationSec < 0.3) {
    throw new Error(
      `Waveform duration (${durationSec.toFixed(3)}s) is shorter than 0.3s required for instrumental intensity calculation.`
    );
  }

  // Convert to unified unit: gal (cm/s²)
  const unitScale = unit === 'm/s^2' ? 100.0 : 1.0;

  const nsGal = new Float64Array(n);
  const ewGal = new Float64Array(n);
  const udGal = new Float64Array(n);

  let allZero = true;
  for (let i = 0; i < n; i++) {
    const vNs = ns[i] * unitScale;
    const vEw = ew[i] * unitScale;
    const vUd = ud[i] * unitScale;

    if (!Number.isFinite(vNs) || !Number.isFinite(vEw) || !Number.isFinite(vUd)) {
      throw new Error(`Invalid acceleration sample at index ${i}`);
    }

    nsGal[i] = vNs;
    ewGal[i] = vEw;
    udGal[i] = vUd;

    if (vNs !== 0 || vEw !== 0 || vUd !== 0) {
      allZero = false;
    }
  }

  // If all components are exactly zero, shaking is zero
  if (allZero) {
    const zeroWaveform = new Float64Array(n);
    return {
      vectorMagnitudeWaveform: zeroWaveform,
      filtered: {
        ns: zeroWaveform,
        ew: zeroWaveform,
        ud: zeroWaveform
      },
      thresholdAcceleration: 0.0,
      rawInstrumentalIntensity: -Infinity,
      instrumentalIntensity: 0.0,
      intensityScale: '0',
      durationSec
    };
  }

  // Apply official JMA frequency-domain filter to each component
  const filteredNs = applyJmaIntensityFilter(nsGal, dt);
  const filteredEw = applyJmaIntensityFilter(ewGal, dt);
  const filteredUd = applyJmaIntensityFilter(udGal, dt);

  // Vector synthesis of the 3 filtered components
  const vectorMagnitude = synthesizeThreeComponents(filteredNs, filteredEw, filteredUd);

  // Determine threshold acceleration a0 where cumulative duration >= 0.3s
  const a0 = findCumulativeDurationThreshold(vectorMagnitude, dt, 0.3);

  if (a0 <= 0.0) {
    return {
      vectorMagnitudeWaveform: vectorMagnitude,
      filtered: {
        ns: filteredNs,
        ew: filteredEw,
        ud: filteredUd
      },
      thresholdAcceleration: 0.0,
      rawInstrumentalIntensity: -Infinity,
      instrumentalIntensity: 0.0,
      intensityScale: '0',
      durationSec
    };
  }

  // Formula: I = 2 * log10(a0) + 0.94
  const rawInstrumentalIntensity = 2.0 * Math.log10(a0) + 0.94;
  const instrumentalIntensity = roundJmaInstrumentalIntensity(rawInstrumentalIntensity);
  const intensityScale = toJmaIntensityScale(instrumentalIntensity);

  return {
    vectorMagnitudeWaveform: vectorMagnitude,
    filtered: {
      ns: filteredNs,
      ew: filteredEw,
      ud: filteredUd
    },
    thresholdAcceleration: a0,
    rawInstrumentalIntensity,
    instrumentalIntensity,
    intensityScale,
    durationSec
  };
}
