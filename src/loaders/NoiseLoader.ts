/**
 * src/loaders/NoiseLoader.ts
 * ==========================
 * Loads daily‑life noise values for each station from a CSV file.
 * The CSV is expected to have the following columns (including a header line):
 *   station,lat,lon,mesh_code,population_density_km2
 * The fifth column (population_density_km2) is used as the noise value.
 * If the file is missing, malformed, or a line cannot be parsed, the corresponding
 * entry in the returned Float32Array is set to 0.
 */

export async function loadDailyNoise(totalStations: number): Promise<Float32Array> {
  // Path to the CSV file. This matches the location used in the production build.
  const url = 'station_noise/prepared/station_density.csv';
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      // If the request fails, fall back to a zero‑filled array.
      return new Float32Array(totalStations);
    }
    const text = await resp.text();
    // Split into lines, trimming any trailing newline.
    const lines = text.trim().split(/\r?\n/);
    // The first line is a header; skip it.
    const dataLines = lines[0].startsWith('station') ? lines.slice(1) : lines;
    const arr = new Float32Array(totalStations);
    // Populate the array in order of appearance (index i corresponds to line i).
    for (let i = 0; i < totalStations && i < dataLines.length; i++) {
      const line = dataLines[i].trim();
      if (!line) {
        arr[i] = 0;
        continue;
      }
      const cols = line.split(',');
      // Expect at least 5 columns; if not, treat as missing.
      if (cols.length < 5) {
        arr[i] = 0;
        continue;
      }
      const densityStr = cols[4];
      const density = parseFloat(densityStr);
      arr[i] = Number.isFinite(density) ? density : 0;
    }
    return arr;
  } catch (_) {
    // Any error (network, parsing, etc.) results in a zero‑filled fallback.
    return new Float32Array(totalStations);
  }
}
