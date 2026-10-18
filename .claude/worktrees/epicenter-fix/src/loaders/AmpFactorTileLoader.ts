/**
 * src/loaders/AmpFactorTileLoader.ts
 * =================================
 * Utility to compute ground amplification (ARV) factors for stations by sampling the public/tiles mesh PNGs.
 * The PNG tiles encode ARV in the red channel where ARV = 0.5 + (R/255) * 2.5 (same as the shader logic).
 * This loader groups stations by tile to minimize network requests.
 */

export async function computeAmpFactorsFromTiles(
  lats: Float32Array,
  lons: Float32Array,
  tileBaseUrl: string = '/tiles/mesh',
  tileSize: number = 256,
  zoom: number = 5,
  fallbackAmpFactors?: Float32Array
): Promise<Float32Array> {
  const N = lats.length;
  const ampFactors = fallbackAmpFactors?.length === N
    ? new Float32Array(fallbackAmpFactors)
    : new Float32Array(N).fill(1);

  // Helper to convert lat/lon to tile x,y and pixel offsets.
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const n = Math.pow(2, zoom);

  interface Entry {
    indices: number[];
    xs: number[];
    ys: number[];
  }

  const tileMap = new Map<string, Entry>();

  for (let i = 0; i < N; i++) {
    const lat = lats[i];
    const lon = lons[i];
    const x = ((lon + 180) / 360) * n;
    const y = ((1 - Math.log(Math.tan(toRad(lat)) + 1 / Math.cos(toRad(lat))) / Math.PI) / 2) * n;
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);
    const pixelX = Math.min(tileSize - 1, Math.floor((x - tileX) * tileSize));
    const pixelY = Math.min(tileSize - 1, Math.floor((y - tileY) * tileSize));
    const key = `${zoom}/${tileX}/${tileY}`;
    let entry = tileMap.get(key);
    if (!entry) {
      entry = { indices: [], xs: [], ys: [] };
      tileMap.set(key, entry);
    }
    entry.indices.push(i);
    entry.xs.push(pixelX);
    entry.ys.push(pixelY);
  }

  // Create a hidden canvas for pixel reading.
  const canvas = document.createElement('canvas');
  canvas.width = tileSize;
  canvas.height = tileSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context not available');

  // Load each tile and sample required pixels.
  const tilePromises = Array.from(tileMap.entries()).map(async ([key, entry]) => {
    const [z, tx, ty] = key.split('/').map(Number);
    const url = `${tileBaseUrl}/${z}/${tx}/${ty}.png`;
    const resp = await fetch(url);
    if (!resp.ok) {
      // Preserve the station dataset's amplification value when a tile is absent.
      return;
    }
    const blob = await resp.blob();
    const img = await createImageBitmap(blob);
    ctx.clearRect(0, 0, tileSize, tileSize);
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, tileSize, tileSize);
    const data = imageData.data;
    for (let i = 0; i < entry.indices.length; i++) {
      const px = entry.xs[i];
      const py = entry.ys[i];
      const idx = (py * tileSize + px) * 4;
      const r = data[idx]; // red channel 0-255
      const arv = 0.5 + (r / 255) * 2.5;
      ampFactors[entry.indices[i]] = arv;
    }
  });

  await Promise.all(tilePromises);
  return ampFactors;
}
