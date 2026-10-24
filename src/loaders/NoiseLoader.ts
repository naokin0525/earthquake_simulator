/**
 * src/loaders/NoiseLoader.ts
 * ==========================
 * Loads station population densities for ambient display variation.
 * The CSV is expected to have the following columns (including a header line):
 *   station,lat,lon,mesh_code,population_density_km2
 * The fifth column is people/km² and must not be used as physical PGV noise.
 * Throws if the published CSV is missing, malformed, or does not match the station count.
 */

const DAILY_NOISE_CSV_URL = '/data/station_density.csv';
const DAILY_NOISE_COLUMNS = ['station', 'lat', 'lon', 'mesh_code', 'population_density_km2'];

function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else if (char === '"' && field.length === 0) {
      inQuotes = true;
    } else {
      field += char;
    }
  }

  if (inQuotes) {
    throw new Error('Station density CSV contains an unterminated quoted field');
  }
  fields.push(field);
  return fields;
}

export async function loadDailyNoise(totalStations: number): Promise<Float32Array> {
  if (!Number.isInteger(totalStations) || totalStations < 0) {
    throw new RangeError(`Invalid station count for density CSV: ${totalStations}`);
  }

  const response = await fetch(DAILY_NOISE_CSV_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to load station density CSV from ${DAILY_NOISE_CSV_URL}: ${response.status} ${response.statusText}`
    );
  }

  const lines = (await response.text()).replace(/^\uFEFF/, '').trimEnd().split(/\r?\n/);
  const header = lines.shift();
  if (!header || JSON.stringify(parseCsvRow(header)) !== JSON.stringify(DAILY_NOISE_COLUMNS)) {
    throw new Error(`Station density CSV has an invalid header; expected ${DAILY_NOISE_COLUMNS.join(',')}`);
  }
  if (lines.length !== totalStations) {
    throw new Error(
      `Station density CSV contains ${lines.length} rows; expected ${totalStations} stations`
    );
  }

  const densities = new Float32Array(totalStations);
  for (let i = 0; i < lines.length; i++) {
    const columns = parseCsvRow(lines[i]);
    const density = Number(columns[4]);
    if (columns.length !== DAILY_NOISE_COLUMNS.length || !Number.isFinite(density) || density < 0) {
      throw new Error(`Station density CSV contains invalid data on row ${i + 2}`);
    }
    densities[i] = density;
  }

  return densities;
}
