import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDailyNoise } from '../../src/loaders/NoiseLoader';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadDailyNoise', () => {
  it('loads station densities from the Vite public data URL in station order', async () => {
    const fetchMock = vi.fn(async () => new Response(
      'station,lat,lon,mesh_code,population_density_km2\n' +
      'STA-1,35.1,139.1,533945111,120.5\n' +
      '"Station, Two",35.2,139.2,533945112,48\n'
    ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadDailyNoise(2);

    expect(fetchMock).toHaveBeenCalledWith('/data/station_density.csv');
    expect(Array.from(result)).toEqual([120.5, 48]);
  });

  it('throws when the published density CSV is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404, statusText: 'Not Found' })));

    await expect(loadDailyNoise(1)).rejects.toThrow(
      'Failed to load station density CSV from /data/station_density.csv: 404 Not Found'
    );
  });

  it('throws when the CSV row count does not match the stations', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('station,lat,lon,mesh_code,population_density_km2\n'))
    );

    await expect(loadDailyNoise(1)).rejects.toThrow(
      'Station density CSV contains 0 rows; expected 1 stations'
    );
  });
});
