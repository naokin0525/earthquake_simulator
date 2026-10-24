/**
 * tests/physics/intensity.test.ts
 * ===============================
 * Unit tests validating JMA Instrumental Seismic Intensity (計測震度) calculation,
 * frequency-domain filtering, 3-component synthesis, duration thresholding (0.3s),
 * boundary conditions, and reference data benchmarks.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateInstrumentalIntensity,
  findCumulativeDurationThreshold,
  roundJmaInstrumentalIntensity,
  toJmaIntensityScale,
  synthesizeThreeComponents,
  jmaScaleToNumeric,
  isJmaGreaterOrEqual,
  formatJmaIntensityJapanese
} from '../../src/core/physics/intensity';
import {
  getPeriodicEffectFilter,
  getHighCutFilter,
  getLowCutFilter,
  getJmaCompositeFilter,
  applyJmaIntensityFilter
} from '../../src/core/physics/intensityFilter';

describe('JMA Instrumental Seismic Intensity Engine', () => {
  // ============================================================================
  // 1. Comparison with Official JMA Reference Data
  // ============================================================================
  describe('JMA Official Reference Data & Formula Verification', () => {
    it('should reproduce the official JMA calculation example (2000 Western Tottori Earthquake / Yonago City)', () => {
      // Reference: JMA official publication "計測震度の算出方法"
      // Threshold acceleration satisfying cumulative duration >= 0.3s: a0 = 127.85 gal
      const a0 = 127.85;

      // Unrounded continuous intensity: I = 2 * log10(a0) + 0.94
      const rawIntensity = 2.0 * Math.log10(a0) + 0.94;
      expect(rawIntensity).toBeCloseTo(5.1534, 3);

      // Round 3rd decimal place -> 5.15, truncate 2nd decimal place -> 5.1
      const instrumentalIntensity = roundJmaInstrumentalIntensity(rawIntensity);
      expect(instrumentalIntensity).toBe(5.1);

      // Discrete JMA scale: 5.0 <= I < 5.5 -> '5+' (震度5強)
      const scale = toJmaIntensityScale(instrumentalIntensity);
      expect(scale).toBe('5+');
      expect(formatJmaIntensityJapanese(scale)).toBe('震度5強');
    });

    it('should accurately calculate threshold acceleration a0 for cumulative duration 0.3s', () => {
      const dt = 0.01; // 100 Hz sampling rate
      const totalSamples = 200; // 2.0 seconds of data

      // Create a sorted test vector where the 30th largest sample (0.3s / 0.01s = 30 samples)
      // is exactly 127.85 gal
      const waveform = new Float64Array(totalSamples);
      for (let i = 0; i < totalSamples; i++) {
        if (i < 30) {
          // Top 30 samples (indices 0..29) >= 127.85
          waveform[i] = 127.85 + (29 - i) * 1.5;
        } else {
          // Remaining samples < 127.85
          waveform[i] = 50.0 - (i - 30) * 0.2;
        }
      }

      // Sample 30 is at index 29: waveform[29] === 127.85
      const a0 = findCumulativeDurationThreshold(waveform, dt, 0.3);
      expect(a0).toBeCloseTo(127.85, 4);
    });

    it('should compute full instrumental intensity pipeline on deterministic synthetic waveform', () => {
      // Deterministic synthetic waveform: 1.0 Hz dominant frequency, 100 Hz sampling, 5.0 seconds
      const dt = 0.01;
      const n = 500;
      const ns = new Float64Array(n);
      const ew = new Float64Array(n);
      const ud = new Float64Array(n);

      for (let i = 0; i < n; i++) {
        const t = i * dt;
        const envelopeT = Math.sin((Math.PI * t) / 5.0); // smooth bell window
        ns[i] = 120.0 * envelopeT * Math.sin(2.0 * Math.PI * 1.0 * t);
        ew[i] = 80.0 * envelopeT * Math.cos(2.0 * Math.PI * 1.0 * t);
        ud[i] = 40.0 * envelopeT * Math.sin(2.0 * Math.PI * 2.0 * t);
      }

      const res = calculateInstrumentalIntensity({ ns, ew, ud, dt, unit: 'gal' });

      expect(res.durationSec).toBe(5.0);
      expect(res.thresholdAcceleration).toBeGreaterThan(50.0);
      expect(res.thresholdAcceleration).toBeLessThan(200.0);
      expect(res.instrumentalIntensity).toBeGreaterThan(4.0);
      expect(res.instrumentalIntensity).toBeLessThan(6.0);
      expect(['4', '5-', '5+']).toContain(res.intensityScale);
    });
  });

  // ============================================================================
  // 2. Waveforms Where All Three Components Are Zero
  // ============================================================================
  describe('Zero Waveform Handling', () => {
    it('should handle waveforms where all three components are zero without error or NaN', () => {
      const dt = 0.01;
      const n = 500; // 5 seconds of zeros
      const ns = new Float64Array(n);
      const ew = new Float64Array(n);
      const ud = new Float64Array(n);

      const res = calculateInstrumentalIntensity({ ns, ew, ud, dt });

      expect(res.thresholdAcceleration).toBe(0.0);
      expect(res.instrumentalIntensity).toBe(0.0);
      expect(res.intensityScale).toBe('0');
      expect(res.durationSec).toBe(5.0);
      expect(res.vectorMagnitudeWaveform.length).toBe(n);

      // Filtered components should also be all zero
      expect(res.filtered.ns.every((v) => v === 0.0)).toBe(true);
      expect(res.filtered.ew.every((v) => v === 0.0)).toBe(true);
      expect(res.filtered.ud.every((v) => v === 0.0)).toBe(true);
    });
  });

  // ============================================================================
  // 3. Error Handling for Invalid Inputs & Sampling Intervals
  // ============================================================================
  describe('Input Validation & Error Handling', () => {
    const validWaveform = new Float64Array(100);

    it('should throw an error for invalid or non-positive sampling interval dt', () => {
      expect(() =>
        calculateInstrumentalIntensity({
          ns: validWaveform,
          ew: validWaveform,
          ud: validWaveform,
          dt: 0
        })
      ).toThrowError(/sampling interval/i);

      expect(() =>
        calculateInstrumentalIntensity({
          ns: validWaveform,
          ew: validWaveform,
          ud: validWaveform,
          dt: -0.01
        })
      ).toThrowError(/sampling interval/i);

      expect(() =>
        calculateInstrumentalIntensity({
          ns: validWaveform,
          ew: validWaveform,
          ud: validWaveform,
          dt: NaN
        })
      ).toThrowError(/sampling interval/i);
    });

    it('should throw an error for unsupported acceleration units', () => {
      expect(() =>
        calculateInstrumentalIntensity({
          ns: validWaveform,
          ew: validWaveform,
          ud: validWaveform,
          dt: 0.01,
          unit: 'g' as any
        })
      ).toThrowError(/unsupported unit/i);

      expect(() =>
        calculateInstrumentalIntensity({
          ns: validWaveform,
          ew: validWaveform,
          ud: validWaveform,
          dt: 0.01,
          unit: 'ft/s^2' as any
        })
      ).toThrowError(/unsupported unit/i);
    });

    it('should throw an error if component lengths are mismatched', () => {
      const ns = new Float64Array(100);
      const ew = new Float64Array(90);
      const ud = new Float64Array(100);

      expect(() =>
        calculateInstrumentalIntensity({ ns, ew, ud, dt: 0.01 })
      ).toThrowError(/component length mismatch/i);
    });

    it('should throw an error if waveform duration is shorter than 0.3 seconds', () => {
      // 20 samples at dt = 0.01s is only 0.20s
      const shortWaveform = new Float64Array(20);
      expect(() =>
        calculateInstrumentalIntensity({
          ns: shortWaveform,
          ew: shortWaveform,
          ud: shortWaveform,
          dt: 0.01
        })
      ).toThrowError(/shorter than 0\.3s/i);
    });

    it('should throw an error for empty waveform arrays', () => {
      const empty = new Float64Array(0);
      expect(() =>
        calculateInstrumentalIntensity({
          ns: empty,
          ew: empty,
          ud: empty,
          dt: 0.01
        })
      ).toThrowError(/must not be empty/i);
    });

    it('should throw an error if any acceleration sample is NaN or infinite', () => {
      const ns = new Float64Array(50);
      ns[10] = NaN;
      const ew = new Float64Array(50);
      const ud = new Float64Array(50);

      expect(() =>
        calculateInstrumentalIntensity({ ns, ew, ud, dt: 0.01 })
      ).toThrowError(/invalid acceleration/i);
    });
  });

  // ============================================================================
  // 4. Verification of Boundary Values for Seismic Intensity Scales
  // ============================================================================
  describe('Seismic Intensity Scale Boundary Values & Rounding', () => {
    it('should correctly map exact boundary values to discrete JMA intensity scales', () => {
      // Standard discrete mapping:
      // I < 0.5 -> '0'
      expect(toJmaIntensityScale(-3.0)).toBe('0');
      expect(toJmaIntensityScale(0.0)).toBe('0');
      expect(toJmaIntensityScale(0.4)).toBe('0');

      // 0.5 <= I < 1.5 -> '1'
      expect(toJmaIntensityScale(0.5)).toBe('1');
      expect(toJmaIntensityScale(1.4)).toBe('1');

      // 1.5 <= I < 2.5 -> '2'
      expect(toJmaIntensityScale(1.5)).toBe('2');
      expect(toJmaIntensityScale(2.4)).toBe('2');

      // 2.5 <= I < 3.5 -> '3'
      expect(toJmaIntensityScale(2.5)).toBe('3');
      expect(toJmaIntensityScale(3.4)).toBe('3');

      // 3.5 <= I < 4.5 -> '4'
      expect(toJmaIntensityScale(3.5)).toBe('4');
      expect(toJmaIntensityScale(4.4)).toBe('4');

      // 4.5 <= I < 5.0 -> '5-'
      expect(toJmaIntensityScale(4.5)).toBe('5-');
      expect(toJmaIntensityScale(4.9)).toBe('5-');

      // 5.0 <= I < 5.5 -> '5+'
      expect(toJmaIntensityScale(5.0)).toBe('5+');
      expect(toJmaIntensityScale(5.4)).toBe('5+');

      // 5.5 <= I < 6.0 -> '6-'
      expect(toJmaIntensityScale(5.5)).toBe('6-');
      expect(toJmaIntensityScale(5.9)).toBe('6-');

      // 6.0 <= I < 6.5 -> '6+'
      expect(toJmaIntensityScale(6.0)).toBe('6+');
      expect(toJmaIntensityScale(6.4)).toBe('6+');

      // I >= 6.5 -> '7'
      expect(toJmaIntensityScale(6.5)).toBe('7');
      expect(toJmaIntensityScale(7.0)).toBe('7');
      expect(toJmaIntensityScale(8.2)).toBe('7');
    });

    it('should correctly execute the 2-step JMA rounding (round 3rd decimal place, truncate 2nd decimal place)', () => {
      // Case 1: 5.1534 -> round 3rd: 5.15 -> truncate 2nd: 5.1
      expect(roundJmaInstrumentalIntensity(5.1534)).toBe(5.1);

      // Case 2: 5.126 -> round 3rd: 5.13 -> truncate 2nd: 5.1
      expect(roundJmaInstrumentalIntensity(5.126)).toBe(5.1);

      // Case 3: 5.196 -> round 3rd: 5.20 -> truncate 2nd: 5.2
      expect(roundJmaInstrumentalIntensity(5.196)).toBe(5.2);

      // Case 4: 5.194 -> round 3rd: 5.19 -> truncate 2nd: 5.1
      expect(roundJmaInstrumentalIntensity(5.194)).toBe(5.1);

      // Boundary around 4.5:
      // 4.496 -> round 3rd: 4.50 -> truncate 2nd: 4.5
      expect(roundJmaInstrumentalIntensity(4.496)).toBe(4.5);
      // 4.494 -> round 3rd: 4.49 -> truncate 2nd: 4.4
      expect(roundJmaInstrumentalIntensity(4.494)).toBe(4.4);

      // Boundary around 5.0:
      // 4.996 -> round 3rd: 5.00 -> truncate 2nd: 5.0
      expect(roundJmaInstrumentalIntensity(4.996)).toBe(5.0);
      // 4.994 -> round 3rd: 4.99 -> truncate 2nd: 4.9
      expect(roundJmaInstrumentalIntensity(4.994)).toBe(4.9);

      // Boundary around 6.5:
      // 6.496 -> round 3rd: 6.50 -> truncate 2nd: 6.5
      expect(roundJmaInstrumentalIntensity(6.496)).toBe(6.5);
      // 6.494 -> round 3rd: 6.49 -> truncate 2nd: 6.4
      expect(roundJmaInstrumentalIntensity(6.494)).toBe(6.4);
    });

    it('should correctly order and compare JMA intensity scales', () => {
      expect(isJmaGreaterOrEqual('5-', '4')).toBe(true);
      expect(isJmaGreaterOrEqual('5+', '5-')).toBe(true);
      expect(isJmaGreaterOrEqual('7', '6+')).toBe(true);
      expect(isJmaGreaterOrEqual('3', '4')).toBe(false);
      expect(jmaScaleToNumeric('7')).toBeGreaterThan(jmaScaleToNumeric('6+'));
    });
  });

  // ============================================================================
  // 5. Determinism & Idempotence (Same Input -> Same Output)
  // ============================================================================
  describe('Deterministic Reproducibility', () => {
    it('should produce identical results from repeated calculations on the same input waveform', () => {
      const dt = 0.01;
      const n = 300;
      const ns = new Float64Array(n);
      const ew = new Float64Array(n);
      const ud = new Float64Array(n);

      for (let i = 0; i < n; i++) {
        const t = i * dt;
        ns[i] = 45.0 * Math.sin(2.0 * Math.PI * 2.5 * t);
        ew[i] = 30.0 * Math.cos(2.0 * Math.PI * 1.8 * t);
        ud[i] = 15.0 * Math.sin(2.0 * Math.PI * 3.0 * t);
      }

      const run1 = calculateInstrumentalIntensity({ ns, ew, ud, dt });
      const run2 = calculateInstrumentalIntensity({ ns, ew, ud, dt });

      expect(run1.thresholdAcceleration).toBe(run2.thresholdAcceleration);
      expect(run1.rawInstrumentalIntensity).toBe(run2.rawInstrumentalIntensity);
      expect(run1.instrumentalIntensity).toBe(run2.instrumentalIntensity);
      expect(run1.intensityScale).toBe(run2.intensityScale);
      expect(run1.durationSec).toBe(run2.durationSec);
    });
  });

  // ============================================================================
  // 6. Component Distinction & Unit Conversion
  // ============================================================================
  describe('Component Distinction & Unit Unification', () => {
    it('should distinguish 2 horizontal components and 1 vertical component', () => {
      const dt = 0.01;
      const n = 100;
      const ns = new Float64Array(n).fill(30.0);
      const ew = new Float64Array(n).fill(40.0);
      const ud = new Float64Array(n).fill(0.0);

      // Synthesized magnitude: sqrt(30^2 + 40^2 + 0^2) = 50.0
      const synthesized = synthesizeThreeComponents(ns, ew, ud);
      for (let i = 0; i < n; i++) {
        expect(synthesized[i]).toBeCloseTo(50.0, 5);
      }
    });

    it('should produce identical instrumental intensity when input is given in m/s^2 vs gal', () => {
      const dt = 0.01;
      const n = 200;
      const nsGal = new Float64Array(n);
      const ewGal = new Float64Array(n);
      const udGal = new Float64Array(n);

      const nsMps2 = new Float64Array(n);
      const ewMps2 = new Float64Array(n);
      const udMps2 = new Float64Array(n);

      for (let i = 0; i < n; i++) {
        const val = 80.0 * Math.sin(i * 0.1);
        nsGal[i] = val;
        ewGal[i] = val * 0.8;
        udGal[i] = val * 0.5;

        // 1 m/s² = 100 gal
        nsMps2[i] = nsGal[i] / 100.0;
        ewMps2[i] = ewGal[i] / 100.0;
        udMps2[i] = udGal[i] / 100.0;
      }

      const resGal = calculateInstrumentalIntensity({
        ns: nsGal,
        ew: ewGal,
        ud: udGal,
        dt,
        unit: 'gal'
      });
      const resMps2 = calculateInstrumentalIntensity({
        ns: nsMps2,
        ew: ewMps2,
        ud: udMps2,
        dt,
        unit: 'm/s^2'
      });

      expect(resMps2.thresholdAcceleration).toBeCloseTo(resGal.thresholdAcceleration, 3);
      expect(resMps2.instrumentalIntensity).toBe(resGal.instrumentalIntensity);
      expect(resMps2.intensityScale).toBe(resGal.intensityScale);
    });
  });

  // ============================================================================
  // 7. JMA Frequency-Domain Filter Characteristics
  // ============================================================================
  describe('JMA Frequency-Domain Filter Characteristics', () => {
    it('should evaluate DC frequency gain as zero (removes drift and baseline offset)', () => {
      expect(getJmaCompositeFilter(0.0)).toBe(0.0);
    });

    it('should match the documented product of the periodic, high-cut, and low-cut gains', () => {
      for (const frequency of [0.05, 0.5, 1.0, 10.0, 25.0]) {
        const documentedGain =
          getPeriodicEffectFilter(frequency) *
          getHighCutFilter(frequency) *
          getLowCutFilter(frequency);
        expect(getJmaCompositeFilter(frequency)).toBeCloseTo(documentedGain, 12);
      }
    });

    it('should attenuate very low frequencies (low-cut filter)', () => {
      const gainLow = getJmaCompositeFilter(0.05);
      const gainMid = getJmaCompositeFilter(1.0);
      expect(gainLow).toBeLessThan(0.15);
      expect(gainLow).toBeLessThan(gainMid);
    });

    it('should attenuate high frequencies above 20 Hz (high-cut filter)', () => {
      const gainMid = getJmaCompositeFilter(1.0);
      const gainHigh = getJmaCompositeFilter(25.0);
      expect(gainHigh).toBeLessThan(0.1);
      expect(gainHigh).toBeLessThan(gainMid);
    });

    it('should preserve passband near 1 Hz with gain close to 1.0', () => {
      const gain1Hz = getJmaCompositeFilter(1.0);
      expect(gain1Hz).toBeGreaterThan(0.95);
      expect(gain1Hz).toBeLessThan(1.05);
    });

    it('should apply frequency-domain filter and preserve output array length', () => {
      const dt = 0.01;
      const n = 256;
      const input = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        input[i] = 10.0 * Math.sin(2.0 * Math.PI * 1.0 * i * dt);
      }

      const filtered = applyJmaIntensityFilter(input, dt);
      expect(filtered.length).toBe(n);
      expect(Number.isFinite(filtered[0])).toBe(true);
    });
  });
});
