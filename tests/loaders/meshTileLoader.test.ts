import { afterEach, describe, expect, it, vi } from 'vitest';
import { preloadMeshTiles } from '../../src/loaders/MeshTileLoader';

const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('preloadMeshTiles', () => {
  it('loads every manifest tile and reports completed progress', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (input.toString().endsWith('/manifest.json')) {
        return new Response(JSON.stringify({ tiles: ['5/1/2.png', '6/3/4.png'] }));
      }
      return new Response(pngSignature);
    });
    vi.stubGlobal('fetch', fetchMock);
    const progress = vi.fn();

    await preloadMeshTiles(progress);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(progress).toHaveBeenNthCalledWith(1, { completed: 0, total: 2 });
    expect(progress).toHaveBeenLastCalledWith({ completed: 2, total: 2 });
  });

  it('reports failed tiles instead of finishing successfully', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (input.toString().endsWith('/manifest.json')) {
        return new Response(JSON.stringify({ tiles: ['5/1/2.png'] }));
      }
      return new Response('missing', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(preloadMeshTiles(() => {})).rejects.toMatchObject({
      name: 'MeshTileLoadError',
      failedTiles: ['5/1/2.png']
    });
  });

  it('rejects invalid tile manifests', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ tiles: ['../outside.png'] })))
    );

    await expect(preloadMeshTiles(() => {})).rejects.toThrow(
      'Ground-amplification tile manifest is empty or invalid'
    );
  });
});
