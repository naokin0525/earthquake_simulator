import type { EarthquakeHypocenter } from '../types';

export interface SlabGridMetadata {
  id: string;
  label: string;
  depthImage: string;
  thicknessImage: string;
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
  width: number;
  height: number;
  gridStepDegrees: number;
  depthOffsetKm: number;
  depthScale: number;
  thicknessOffsetKm: number;
  thicknessScale: number;
  validCells: number;
}

interface SlabGridManifest {
  regions: SlabGridMetadata[];
}

export interface SlabGridRaster {
  metadata: SlabGridMetadata;
  depthPixels: Uint8ClampedArray;
  thicknessPixels: Uint8ClampedArray;
}

export interface SlabDepthContour {
  threshold: number;
  path: [[number, number], [number, number]];
}

export class Slab2Model {
  private constructor(private readonly grids: SlabGridRaster[]) {}

  public static fromRasters(grids: SlabGridRaster[]): Slab2Model {
    return new Slab2Model(grids);
  }

  public getDepthContours(thresholds: number[]): SlabDepthContour[] {
    const contours: SlabDepthContour[] = [];

    for (const { metadata, depthPixels } of this.grids) {
      const sampleDepth = (x: number, y: number): number | null => {
        const pixelIndex = (y * metadata.width + x) * 4;
        const encodedDepth = (depthPixels[pixelIndex] << 8) | depthPixels[pixelIndex + 1];
        return encodedDepth === 0
          ? null
          : metadata.depthOffsetKm + (encodedDepth - 1) / metadata.depthScale;
      };

      for (const threshold of thresholds) {
        for (let y = 0; y < metadata.height - 1; y += 1) {
          for (let x = 0; x < metadata.width - 1; x += 1) {
            const corners = [
              sampleDepth(x, y),
              sampleDepth(x + 1, y),
              sampleDepth(x + 1, y + 1),
              sampleDepth(x, y + 1)
            ];
            if (corners.some((depth) => depth === null)) continue;
            const depths = corners as [number, number, number, number];
            const cellCase = depths.reduce(
              (value, depth, index) => value | (depth >= threshold ? 1 << index : 0),
              0
            );
            if (cellCase === 0 || cellCase === 15) continue;

            const centerIsDeep = depths.reduce((sum, depth) => sum + depth, 0) / 4 >= threshold;
            const edgePairs = getContourEdgePairs(cellCase, centerIsDeep);
            const edgePoints = [
              interpolateContourPoint(
                [x, y],
                [x + 1, y],
                depths[0],
                depths[1],
                threshold,
                metadata
              ),
              interpolateContourPoint(
                [x + 1, y],
                [x + 1, y + 1],
                depths[1],
                depths[2],
                threshold,
                metadata
              ),
              interpolateContourPoint(
                [x + 1, y + 1],
                [x, y + 1],
                depths[2],
                depths[3],
                threshold,
                metadata
              ),
              interpolateContourPoint(
                [x, y + 1],
                [x, y],
                depths[3],
                depths[0],
                threshold,
                metadata
              )
            ];

            for (const [startEdge, endEdge] of edgePairs) {
              contours.push({
                threshold,
                path: [edgePoints[startEdge], edgePoints[endEdge]]
              });
            }
          }
        }
      }
    }

    return contours;
  }

  public static async load(manifestUrl = '/data/slab2/manifest.json'): Promise<Slab2Model> {
    const manifestResponse = await fetch(manifestUrl);
    if (!manifestResponse.ok) {
      throw new Error(`Failed to load Slab2 manifest (${manifestResponse.status}): ${manifestUrl}`);
    }
    const manifest = await manifestResponse.json() as SlabGridManifest;
    if (!Array.isArray(manifest.regions) || manifest.regions.length === 0) {
      throw new Error('Slab2 manifest contains no regions');
    }

    const grids = await Promise.all(manifest.regions.map(async (metadata) => {
      const [depthPixels, thicknessPixels] = await Promise.all([
        loadRasterPixels(metadata.depthImage, metadata.width, metadata.height),
        loadRasterPixels(metadata.thicknessImage, metadata.width, metadata.height)
      ]);
      return { metadata, depthPixels, thicknessPixels };
    }));

    return new Slab2Model(grids);
  }

  public isInsideSlab(lat: number, lon: number, depthKm: number): boolean {
    for (const { metadata, depthPixels, thicknessPixels } of this.grids) {
      if (
        lon < metadata.minLon || lon > metadata.maxLon ||
        lat < metadata.minLat || lat > metadata.maxLat
      ) {
        continue;
      }

      const x = Math.round((lon - metadata.minLon) / metadata.gridStepDegrees);
      const y = Math.round((metadata.maxLat - lat) / metadata.gridStepDegrees);
      const pixelIndex = (y * metadata.width + x) * 4;
      const encodedDepth = (depthPixels[pixelIndex] << 8) | depthPixels[pixelIndex + 1];
      const encodedThickness = (thicknessPixels[pixelIndex] << 8) | thicknessPixels[pixelIndex + 1];
      if (encodedDepth === 0 || encodedThickness === 0) continue;
      const topDepthKm = metadata.depthOffsetKm + (encodedDepth - 1) / metadata.depthScale;
      const thicknessKm = metadata.thicknessOffsetKm + (encodedThickness - 1) / metadata.thicknessScale;
      if (depthKm >= topDepthKm && depthKm <= topDepthKm + thicknessKm) return true;
    }
    return false;
  }
}

type ContourEdgePair = [number, number];

function getContourEdgePairs(cellCase: number, centerIsDeep: boolean): ContourEdgePair[] {
  switch (cellCase) {
    case 1: return [[3, 0]];
    case 2: return [[0, 1]];
    case 3: return [[3, 1]];
    case 4: return [[1, 2]];
    case 5: return centerIsDeep ? [[3, 2], [0, 1]] : [[3, 0], [1, 2]];
    case 6: return [[0, 2]];
    case 7: return [[3, 2]];
    case 8: return [[2, 3]];
    case 9: return [[0, 2]];
    case 10: return centerIsDeep ? [[3, 0], [1, 2]] : [[0, 1], [2, 3]];
    case 11: return [[1, 2]];
    case 12: return [[1, 3]];
    case 13: return [[0, 1]];
    case 14: return [[3, 0]];
    default: return [];
  }
}

function interpolateContourPoint(
  start: [number, number],
  end: [number, number],
  startDepth: number,
  endDepth: number,
  threshold: number,
  metadata: SlabGridMetadata
): [number, number] {
  const fraction = startDepth === endDepth
    ? 0.5
    : Math.max(0, Math.min(1, (threshold - startDepth) / (endDepth - startDepth)));
  const x = start[0] + (end[0] - start[0]) * fraction;
  const y = start[1] + (end[1] - start[1]) * fraction;
  return [
    metadata.minLon + x * metadata.gridStepDegrees,
    metadata.maxLat - y * metadata.gridStepDegrees
  ];
}

async function loadRasterPixels(
  imageUrl: string,
  expectedWidth: number,
  expectedHeight: number
): Promise<Uint8ClampedArray> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to load Slab2 image (${response.status}): ${imageUrl}`);
  }
  const bitmap = await createImageBitmap(await response.blob());
  if (bitmap.width !== expectedWidth || bitmap.height !== expectedHeight) {
    bitmap.close();
    throw new Error(`Slab2 image dimensions do not match manifest: ${imageUrl}`);
  }

  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  } else if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
  } else {
    bitmap.close();
    throw new Error('Canvas or OffscreenCanvas is required to decode Slab2 images');
  }
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error(`Unable to create a 2D canvas context for ${imageUrl}`);
  }
  context.drawImage(bitmap, 0, 0);
  const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  bitmap.close();
  return pixels;
}

/**
 * Retained for callers without loaded Slab2 data. Production simulation paths pass Slab2Model.
 */
export function calculateSlabFraction(
  hypoLat: number,
  hypoLon: number,
  hypoDepth: number,
  stationLat: number,
  stationLon: number,
  slabModel?: Slab2Model
): number {
  if (slabModel) {
    return traceSlabFraction(
      { lat: hypoLat, lon: hypoLon, depth: hypoDepth },
      stationLat,
      stationLon,
      slabModel
    );
  }

  if (hypoDepth < 80.0) {
    return 0.0;
  }

  // Calculate azimuth from hypocenter to station (in radians)
  const dLat = (stationLat - hypoLat) * (Math.PI / 180.0);
  const dLon = (stationLon - hypoLon) * (Math.PI / 180.0);
  const cosMeanLat = Math.cos(((hypoLat + stationLat) / 2.0) * (Math.PI / 180.0));

  const dy = dLat;
  const dx = dLon * cosMeanLat;
  const azimuth = Math.atan2(dx, dy); // Azimuth clockwise from North (-pi to +pi)

  // Pacific Plate subducts dipping West (trench is to the East, ~90 deg to 120 deg azimuth)
  // Trench normal vector is roughly East-Southeast (azimuth ~ 100 degrees)
  const trenchNormalAzimuth = 100.0 * (Math.PI / 180.0);
  
  // Cosine of angle between ray azimuth and trench vector
  const alignment = Math.cos(azimuth - trenchNormalAzimuth);

  // Depth weight scaling (deeper hypocenters exhibit stronger slab path differentiation)
  const depthFactor = Math.min(1.0, (hypoDepth - 80.0) / 200.0);

  // If ray is directed toward the Pacific coast/trench (alignment > 0)
  if (alignment > 0.0) {
    const rSlab = alignment * depthFactor * 0.95;
    return Math.max(0.0, Math.min(1.0, rSlab));
  }

  return 0.0;
}

const EARTH_RADIUS_KM = 6371.0088;
const RAY_SAMPLE_SPACING_KM = 5.0;

function createGreatCircleInterpolator(
  startLat: number,
  startLon: number,
  endLat: number,
  endLon: number
): (fraction: number, point: { lat: number; lon: number }) => void {
  const toRadians = Math.PI / 180;
  const lat1 = startLat * toRadians;
  const lon1 = startLon * toRadians;
  const lat2 = endLat * toRadians;
  const lon2 = endLon * toRadians;
  const x1 = Math.cos(lat1) * Math.cos(lon1);
  const y1 = Math.cos(lat1) * Math.sin(lon1);
  const z1 = Math.sin(lat1);
  const x2 = Math.cos(lat2) * Math.cos(lon2);
  const y2 = Math.cos(lat2) * Math.sin(lon2);
  const z2 = Math.sin(lat2);
  const angle = Math.acos(Math.max(-1, Math.min(1, x1 * x2 + y1 * y2 + z1 * z2)));
  const sinAngle = Math.sin(angle);

  return (fraction, point) => {
    let x = x1;
    let y = y1;
    let z = z1;
    if (angle >= 1e-8) {
      const startWeight = Math.sin((1 - fraction) * angle) / sinAngle;
      const endWeight = Math.sin(fraction * angle) / sinAngle;
      x = x1 * startWeight + x2 * endWeight;
      y = y1 * startWeight + y2 * endWeight;
      z = z1 * startWeight + z2 * endWeight;
    }
    point.lat = Math.atan2(z, Math.hypot(x, y)) / toRadians;
    point.lon = Math.atan2(y, x) / toRadians;
  };
}

export function traceSlabFraction(
  hypocenter: Pick<EarthquakeHypocenter, 'lat' | 'lon' | 'depth'>,
  stationLat: number,
  stationLon: number,
  slabModel: Slab2Model
): number {
  const toRadians = Math.PI / 180;
  const lat1 = hypocenter.lat * toRadians;
  const lat2 = stationLat * toRadians;
  const deltaLat = lat2 - lat1;
  const deltaLon = (stationLon - hypocenter.lon) * toRadians;
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  const surfaceDistanceKm = 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const verticalDistanceKm = hypocenter.depth;
  const rayLengthKm = Math.hypot(surfaceDistanceKm, verticalDistanceKm);
  if (rayLengthKm === 0) return 0;

  const sampleCount = Math.max(1, Math.ceil(rayLengthKm / RAY_SAMPLE_SPACING_KM));
  const interpolate = createGreatCircleInterpolator(
    hypocenter.lat,
    hypocenter.lon,
    stationLat,
    stationLon
  );
  const point = { lat: 0, lon: 0 };
  let inSlabSamples = 0;
  for (let index = 0; index < sampleCount; index++) {
    const fraction = (index + 0.5) / sampleCount;
    interpolate(fraction, point);
    const depthKm = hypocenter.depth * (1 - fraction);
    if (slabModel.isInsideSlab(point.lat, point.lon, depthKm)) inSlabSamples++;
  }
  return inSlabSamples / sampleCount;
}
