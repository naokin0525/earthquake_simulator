/**
 * src/loaders/NoiseLoader.ts
 * ==========================
 * Loads pre‑computed daily‑life noise values for each station.
 * Expected format: a JSON object mapping station index (as string) to a numeric noise value (PGV in cm/s).
 * If the file is missing or malformed, a zero-filled Float32Array is returned.
 */

export async function loadDailyNoise(totalStations: number): Promise<Float32Array> {
  const url = '/data/station_noise/prepared/noise.json'; // Adjust path if needed.
  try {
    const resp = await fetch(url);
    if (!resp.ok) return new Float32Array(totalStations);
    const json: Record<string, number> = await resp.json();
    const arr = new Float32Array(totalStations);
    for (let i = 0; i < totalStations; i++) {
      const val = json[i.toString()];
      arr[i] = typeof val === 'number' ? val : 0;
    }
    return arr;
  } catch (_) {
    return new Float32Array(totalStations);
  }
}
