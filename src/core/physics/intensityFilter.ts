/**
 * src/core/physics/intensityFilter.ts
 * ===================================
 * Japan Meteorological Agency (JMA) Instrumental Seismic Intensity Filter.
 *
 * Implements the official JMA frequency-domain filter transfer function
 * and Fast Fourier Transform (FFT) signal processing pipeline.
 *
 * References:
 * - Japan Meteorological Agency (JMA) official specification:
 *   "計測震度の算出方法" (Calculation Method of Instrumental Seismic Intensity)
 *   https://www.data.jma.go.jp/eqev/data/kyoshin/kaisetsu/calc_sindo.html
 */

/**
 * Evaluates the JMA period-effect filter (周期効果フィルター):
 *   F_F(f) = (1 / f)^(1/2)
 *
 * @param f Frequency in Hz (f > 0)
 * @returns Filter gain magnitude
 */
export function getPeriodicEffectFilter(f: number): number {
  if (f <= 0) return 0.0;
  return Math.sqrt(1.0 / f);
}

/**
 * Evaluates the JMA high-cut filter (ハイカットフィルター):
 *   F_H(f) = (1 + 0.694*y^2 + 0.241*y^4 + 0.0557*y^6 + 0.009664*y^8 + 0.00134*y^10 + 0.000155*y^12)^(-1/2)
 *   where y = f / 10
 *
 * @param f Frequency in Hz (f >= 0)
 * @returns Filter gain magnitude
 */
export function getHighCutFilter(f: number): number {
  if (f < 0) return 0.0;
  const y = f / 10.0;
  const y2 = y * y;
  const y4 = y2 * y2;
  const y6 = y4 * y2;
  const y8 = y4 * y4;
  const y10 = y8 * y2;
  const y12 = y6 * y6;

  const poly =
    1.0 +
    0.694 * y2 +
    0.241 * y4 +
    0.0557 * y6 +
    0.009664 * y8 +
    0.00134 * y10 +
    0.000155 * y12;

  return 1.0 / Math.sqrt(poly);
}

/**
 * Evaluates the JMA low-cut filter (ローカットフィルター):
 *   F_L(f) = (1 - exp(-(f / 0.5)^3))^(1/2)
 *
 * @param f Frequency in Hz (f >= 0)
 * @returns Filter gain magnitude
 */
export function getLowCutFilter(f: number): number {
  if (f <= 0) return 0.0;
  const u = Math.pow(f / 0.5, 3);
  // Prevent round-off near zero
  if (u < 1e-6) {
    return Math.sqrt(u);
  }
  return Math.sqrt(1.0 - Math.exp(-u));
}

/**
 * Evaluates the overall JMA composite filter (総合フィルター):
 *   H(f) = F_F(f) * F_H(f) * F_L(f)
 *
 * For f -> 0, the product F_F(f) * F_L(f) = sqrt((1 - exp(-(f/0.5)^3)) / f) -> 0.
 * At f = 0, H(0) = 0.
 *
 * @param f Frequency in Hz
 * @returns Composite filter transfer function magnitude |H(f)|
 */
export function getJmaCompositeFilter(f: number): number {
  if (f <= 0.0) return 0.0;

  const u = Math.pow(f / 0.5, 3);
  // For small u, 1 - exp(-u) = u - u^2/2, so (1 - exp(-u))/f = f^2 / 0.125 = 8 * f^2
  const flOverF = u < 1e-4 ? Math.sqrt(8.0) * f : Math.sqrt((1.0 - Math.exp(-u)) / f);
  const fh = getHighCutFilter(f);

  return flOverF * fh;
}

/**
 * In-place Radix-2 Cooley-Tukey Fast Fourier Transform (FFT) / Inverse FFT (IFFT).
 *
 * @param real Real component array (length must be a power of 2)
 * @param imag Imaginary component array (length must be a power of 2)
 * @param inverse True to compute IFFT, false for forward FFT
 */
export function fft(real: Float64Array, imag: Float64Array, inverse = false): void {
  const n = real.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) {
    throw new Error(`FFT length must be a power of 2, received ${n}`);
  }

  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const tr = real[i];
      real[i] = real[j];
      real[j] = tr;
      const ti = imag[i];
      imag[i] = imag[j];
      imag[j] = ti;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  // Butterfly computations
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angle = ((inverse ? 2.0 : -2.0) * Math.PI) / len;
    const wStepR = Math.cos(angle);
    const wStepI = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wR = 1.0;
      let wI = 0.0;
      for (let k = 0; k < halfLen; k++) {
        const idx1 = i + k;
        const idx2 = idx1 + halfLen;

        const uR = real[idx1];
        const uI = imag[idx1];
        const vR = real[idx2] * wR - imag[idx2] * wI;
        const vI = real[idx2] * wI + imag[idx2] * wR;

        real[idx1] = uR + vR;
        imag[idx1] = uI + vI;
        real[idx2] = uR - vR;
        imag[idx2] = uI - vI;

        const nextWR = wR * wStepR - wI * wStepI;
        const nextWI = wR * wStepI + wI * wStepR;
        wR = nextWR;
        wI = nextWI;
      }
    }
  }

  // Normalization for IFFT
  if (inverse) {
    const invN = 1.0 / n;
    for (let i = 0; i < n; i++) {
      real[i] *= invN;
      imag[i] *= invN;
    }
  }
}

/**
 * Applies the official JMA frequency-domain intensity filter to a single acceleration waveform component.
 *
 * Processing pipeline:
 * 1. Zero-pad waveform to next power of 2.
 * 2. Compute forward FFT to obtain frequency spectrum.
 * 3. Multiply frequency spectrum by JMA composite filter H(f).
 * 4. Compute inverse FFT to return to the time domain.
 * 5. Extract the filtered waveform of original length.
 *
 * @param waveform Acceleration time-series array in gal (cm/s²).
 * @param dt Sampling interval in seconds (e.g., 0.01s for 100 Hz).
 * @returns Filtered acceleration waveform in gal (cm/s²), matching input length.
 */
export function applyJmaIntensityFilter(waveform: ArrayLike<number>, dt: number): Float64Array {
  const n = waveform.length;
  if (n === 0) {
    throw new Error('Input waveform must not be empty');
  }
  if (!Number.isFinite(dt) || dt <= 0) {
    throw new Error(`Invalid sampling interval dt: ${dt}. Must be a finite positive number.`);
  }

  // Find next power of 2 (at least n, minimum 4)
  let nFft = 4;
  while (nFft < n) {
    nFft <<= 1;
  }

  const real = new Float64Array(nFft);
  const imag = new Float64Array(nFft);

  for (let i = 0; i < n; i++) {
    const v = waveform[i];
    if (!Number.isFinite(v)) {
      throw new Error(`Invalid acceleration value at index ${i}: ${v}`);
    }
    real[i] = v;
  }

  // Forward FFT
  fft(real, imag, false);

  // Apply composite filter in frequency domain
  const halfN = nFft >> 1;
  const df = 1.0 / (nFft * dt);

  // DC component (f = 0)
  real[0] = 0.0;
  imag[0] = 0.0;

  // Positive frequencies and their Hermitian symmetric counterparts
  for (let k = 1; k < halfN; k++) {
    const f = k * df;
    const gain = getJmaCompositeFilter(f);

    real[k] *= gain;
    imag[k] *= gain;

    const symIdx = nFft - k;
    real[symIdx] *= gain;
    imag[symIdx] *= gain;
  }

  // Nyquist frequency (f = halfN * df)
  const fNyq = halfN * df;
  const gainNyq = getJmaCompositeFilter(fNyq);
  real[halfN] *= gainNyq;
  imag[halfN] *= gainNyq;

  // Inverse FFT
  fft(real, imag, true);

  // Return original length time series
  const filtered = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    filtered[i] = real[i];
  }

  return filtered;
}
