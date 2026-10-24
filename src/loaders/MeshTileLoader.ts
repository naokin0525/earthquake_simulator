export interface MeshTileManifest {
  tiles: string[];
}

export interface MeshTileLoadProgress {
  completed: number;
  total: number;
}

export class MeshTileLoadError extends Error {
  constructor(public readonly failedTiles: string[]) {
    const shownTiles = failedTiles.slice(0, 5);
    const remaining = failedTiles.length - shownTiles.length;
    const details = shownTiles.join(', ');
    super(
      `Failed to load ${failedTiles.length} of the ground-amplification tiles: ${details}` +
        (remaining > 0 ? `, and ${remaining} more` : '')
    );
    this.name = 'MeshTileLoadError';
  }
}

const TILE_BASE_URL = '/tiles/mesh';
const TILE_MANIFEST_URL = `${TILE_BASE_URL}/manifest.json`;
const MAX_CONCURRENT_TILE_REQUESTS = 8;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function isMeshTileManifest(value: unknown): value is MeshTileManifest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'tiles' in value &&
    Array.isArray(value.tiles) &&
    value.tiles.length > 0 &&
    value.tiles.every(
      (tile: unknown) =>
        typeof tile === 'string' &&
        /^\d+\/\d+\/\d+\.png$/.test(tile)
    )
  );
}

async function loadTileManifest(signal?: AbortSignal): Promise<MeshTileManifest> {
  const response = await fetch(TILE_MANIFEST_URL, { signal });
  if (!response.ok) {
    throw new Error(`Failed to load ground-amplification tile manifest: ${response.status} ${response.statusText}`);
  }

  const manifest: unknown = await response.json();
  if (!isMeshTileManifest(manifest)) {
    throw new Error('Ground-amplification tile manifest is empty or invalid');
  }

  return manifest;
}

export async function preloadMeshTiles(
  onProgress: (progress: MeshTileLoadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const { tiles } = await loadTileManifest(signal);
  let nextIndex = 0;
  let completed = 0;
  const failedTiles: string[] = [];
  onProgress({ completed, total: tiles.length });

  const loadNextTile = async (): Promise<void> => {
    while (nextIndex < tiles.length) {
      if (signal?.aborted) throw new DOMException('Mesh tile loading was cancelled', 'AbortError');
      const tile = tiles[nextIndex++];
      try {
        const response = await fetch(`${TILE_BASE_URL}/${tile}`, { signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = new Uint8Array(await response.arrayBuffer());
        if (!PNG_SIGNATURE.every((byte, index) => data[index] === byte)) {
          throw new Error('Invalid PNG data');
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        failedTiles.push(tile);
      } finally {
        completed++;
        if (completed % 10 === 0 || completed === tiles.length) {
          onProgress({ completed, total: tiles.length });
        }
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(MAX_CONCURRENT_TILE_REQUESTS, tiles.length) },
      () => loadNextTile()
    )
  );

  if (failedTiles.length > 0) {
    throw new MeshTileLoadError(failedTiles);
  }
}
