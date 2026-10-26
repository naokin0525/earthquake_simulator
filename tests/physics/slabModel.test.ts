/**
 * tests/physics/slabModel.test.ts
 * ================================
 * Unit tests validating subducting slab geometry and deep event anomalous seismic intensity (異常震域).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { resolve } from 'node:path';
import {
  calculateSlabFraction,
  Slab2Model,
  SlabGridMetadata,
  SlabGridRaster,
  traceSlabFraction
} from '../../src/core/physics/slabModel';
import { computeTravelTimes } from '../../src/core/physics/travelTime';
import { calculateBedrockPgv, calculateJmaIntensity } from '../../src/core/physics/attenuation';
import { SimulationEngine } from '../../src/core/simulation/SimulationEngine';
import { StationDataBuffer } from '../../src/core/types';
import { pointSourceDistance } from '../../src/core/physics/distance';

function decodeGeneratedPng(imageUrl: string): { width: number; height: number; pixels: Uint8ClampedArray } {
  const imagePath = resolve(process.cwd(), 'public', imageUrl.replace(/^\/+/, ''));
  const png = readFileSync(imagePath);
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect(png[24]).toBe(8);
  expect(png[25]).toBe(6);

  const imageData: Buffer[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') imageData.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(imageData));
  const rowLength = width * 4;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    const sourceOffset = row * (rowLength + 1);
    expect(raw[sourceOffset]).toBe(0);
    pixels.set(raw.subarray(sourceOffset + 1, sourceOffset + 1 + rowLength), row * rowLength);
  }
  return { width, height, pixels };
}

function loadGeneratedSlab2Model(): Slab2Model {
  const manifestPath = resolve(process.cwd(), 'public', 'data', 'slab2', 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { regions: SlabGridMetadata[] };
  const rasters: SlabGridRaster[] = manifest.regions.map((metadata) => {
    const depth = decodeGeneratedPng(metadata.depthImage);
    const thickness = decodeGeneratedPng(metadata.thicknessImage);
    expect(depth.width).toBe(metadata.width);
    expect(depth.height).toBe(metadata.height);
    expect(thickness.width).toBe(metadata.width);
    expect(thickness.height).toBe(metadata.height);
    return {
      metadata,
      depthPixels: depth.pixels,
      thicknessPixels: thickness.pixels
    };
  });
  return Slab2Model.fromRasters(rasters);
}

describe('Subducting Slab & Anomalous Seismic Intensity Model', () => {
  const syntheticGrid = (): Slab2Model => {
    const metadata: SlabGridMetadata = {
      id: 'test',
      label: 'test slab',
      depthImage: '/test_dep.png',
      thicknessImage: '/test_thk.png',
      minLon: 139.9,
      maxLon: 140.1,
      minLat: 34.9,
      maxLat: 35.1,
      width: 5,
      height: 5,
      gridStepDegrees: 0.05,
      depthOffsetKm: 100,
      depthScale: 100,
      thicknessOffsetKm: 100,
      thicknessScale: 100,
      validCells: 25
    };
    const depthPixels = new Uint8ClampedArray(metadata.width * metadata.height * 4);
    const thicknessPixels = new Uint8ClampedArray(metadata.width * metadata.height * 4);
    for (let index = 0; index < metadata.width * metadata.height; index++) {
      const offset = index * 4;
      depthPixels[offset + 1] = 1;
      thicknessPixels[offset + 1] = 1;
      depthPixels[offset + 3] = 255;
      thicknessPixels[offset + 3] = 255;
    }
    return Slab2Model.fromRasters([{ metadata, depthPixels, thicknessPixels }]);
  };

  it('should decode top depth and thickness and exclude NoData pixels', () => {
    const model = syntheticGrid();
    expect(model.isInsideSlab(35.0, 140.0, 100)).toBe(true);
    expect(model.isInsideSlab(35.0, 140.0, 200)).toBe(true);
    expect(model.isInsideSlab(35.0, 140.0, 99.9)).toBe(false);
    expect(model.isInsideSlab(35.0, 140.0, 200.1)).toBe(false);
    expect(model.isInsideSlab(35.0, 139.8, 150)).toBe(false);
  });

  it('should interpolate contour lines from adjacent valid raster cells only', () => {
    const metadata: SlabGridMetadata = {
      id: 'contour-test',
      label: 'contour test',
      depthImage: '/test_dep.png',
      thicknessImage: '/test_thk.png',
      minLon: 139.9,
      maxLon: 140.0,
      minLat: 35.0,
      maxLat: 35.1,
      width: 2,
      height: 2,
      gridStepDegrees: 0.1,
      depthOffsetKm: 0,
      depthScale: 1,
      thicknessOffsetKm: 0,
      thicknessScale: 1,
      validCells: 4
    };
    const depthPixels = new Uint8ClampedArray([
      0, 1, 0, 255, 0, 101, 0, 255,
      0, 101, 0, 255, 0, 1, 0, 255
    ]);
    const model = Slab2Model.fromRasters([{
      metadata,
      depthPixels,
      thicknessPixels: new Uint8ClampedArray(16)
    }]);

    const contours = model.getDepthContours([50]);
    expect(contours).toHaveLength(2);
    expect(contours.map(({ path }) =>
      path.map(([lon, lat]) => [Number(lon.toFixed(6)), Number(lat.toFixed(6))])
    )).toEqual([
      [[139.9, 35.05], [139.95, 35.1]],
      [[140, 35.05], [139.95, 35]]
    ]);

    depthPixels[1] = 0;
    const modelWithNoData = Slab2Model.fromRasters([{
      metadata,
      depthPixels,
      thicknessPixels: new Uint8ClampedArray(16)
    }]);
    expect(modelWithNoData.getDepthContours([50])).toHaveLength(0);
  });

  it('should create translucent depth-filled raster areas and keep NoData transparent', () => {
    const metadata: SlabGridMetadata = {
      id: 'filled-area-test',
      label: 'filled area test',
      depthImage: '/test_dep.png',
      thicknessImage: '/test_thk.png',
      minLon: 139.9,
      maxLon: 140.0,
      minLat: 35.0,
      maxLat: 35.1,
      width: 2,
      height: 2,
      gridStepDegrees: 0.1,
      depthOffsetKm: 0,
      depthScale: 1,
      thicknessOffsetKm: 0,
      thicknessScale: 1,
      validCells: 3
    };
    const model = Slab2Model.fromRasters([{
      metadata,
      depthPixels: new Uint8ClampedArray([
        0, 1, 0, 255, 0, 0, 0, 0,
        0, 61, 0, 255, 0, 121, 0, 255
      ]),
      thicknessPixels: new Uint8ClampedArray(16)
    }]);

    const [area] = model.getDepthAreas();
    expect(area).toMatchObject({
      id: 'filled-area-test',
      width: 2,
      height: 2,
      bounds: [139.9, 35.0, 140.0, 35.1]
    });
    expect(Array.from(area.pixels)).toEqual([
      255, 62, 62, 105, 0, 0, 0, 0,
      255, 31, 31, 105, 133, 0, 0, 105
    ]);
  });

  it('should integrate the fraction of a 3D ray inside a Slab2 slab volume', () => {
    const model = syntheticGrid();
    const fraction = traceSlabFraction(
      { lat: 35.0, lon: 140.0, depth: 150 },
      35.0,
      140.0,
      model
    );
    expect(fraction).toBeCloseTo(1 / 3, 1);
    expect(calculateSlabFraction(35.0, 140.0, 150, 35.0, 140.0, model)).toBe(fraction);
  });

  it('should return 0 slab fraction for shallow hypocenters (depth < 80km)', () => {
    const rSlabShallow = calculateSlabFraction(35.5, 139.0, 30.0, 36.0, 140.0);
    expect(rSlabShallow).toBe(0.0);
  });

  it('should use the generated Slab2 images for real deep-event ray paths', () => {
    const model = loadGeneratedSlab2Model();
    const hypocenter = {
      lat: 37.3,
      lon: 133.9,
      depth: 456.91,
      magnitude: 7.0,
      originTime: 0.0
    };
    const tokyo = { lat: 35.7, lon: 139.7 };
    const kyushu = { lat: 32.8, lon: 130.7 };
    const tokyoFraction = calculateSlabFraction(
      hypocenter.lat,
      hypocenter.lon,
      hypocenter.depth,
      tokyo.lat,
      tokyo.lon,
      model
    );
    const kyushuFraction = calculateSlabFraction(
      hypocenter.lat,
      hypocenter.lon,
      hypocenter.depth,
      kyushu.lat,
      kyushu.lon,
      model
    );

    expect(tokyoFraction).toBeGreaterThan(0.5);
    expect(kyushuFraction).toBeLessThan(0.2);
    expect(tokyoFraction - kyushuFraction).toBeGreaterThan(0.5);

    const tokyoWithSlab = computeTravelTimes(hypocenter, tokyo.lat, tokyo.lon, tokyoFraction);
    const tokyoWithoutSlab = computeTravelTimes(hypocenter, tokyo.lat, tokyo.lon);
    expect(tokyoWithSlab.pArrivalTime).toBeLessThan(tokyoWithoutSlab.pArrivalTime);

    const pgvWithSlab = calculateBedrockPgv(500, hypocenter.depth, hypocenter.magnitude, tokyoFraction);
    const pgvWithoutSlab = calculateBedrockPgv(500, hypocenter.depth, hypocenter.magnitude, 0);
    expect(pgvWithSlab).toBe(pgvWithoutSlab);

    const stations: StationDataBuffer = {
      totalStations: 2,
      lats: new Float32Array([tokyo.lat, kyushu.lat]),
      lons: new Float32Array([tokyo.lon, kyushu.lon]),
      ampFactors: new Float32Array([1, 1]),
      prefCodes: new Uint8Array([13, 43])
    };
    const engine = new SimulationEngine(stations, model);
    engine.init({
      hypocenter,
      timeScale: 1,
      tickIntervalMs: 50,
      noiseStdDev: 0
    });
    const events = engine.update(1000).newTriggers;
    const tokyoEvent = events.find((event) => event.stationIndex === 0);
    expect(tokyoEvent).toBeDefined();
    expect(tokyoEvent?.pArrivalTime).toBeCloseTo(tokyoWithSlab.pArrivalTime, 4);

    const expectedIntensity = calculateJmaIntensity(
      pointSourceDistance(stations.lats[0], stations.lons[0], hypocenter.lat, hypocenter.lon, hypocenter.depth),
      hypocenter.depth,
      hypocenter.magnitude,
      1,
      tokyoFraction,
      undefined,
      stations.lats[0],
      stations.lons[0]
    );
    expect(tokyoEvent?.intensity).toBe(expectedIntensity.jmaScale);
    expect(tokyoEvent?.pgvSurface).toBeCloseTo(expectedIntensity.pgvSurface, 4);
    const expectedWithoutSlab = calculateJmaIntensity(
      pointSourceDistance(stations.lats[0], stations.lons[0], hypocenter.lat, hypocenter.lon, hypocenter.depth),
      hypocenter.depth,
      hypocenter.magnitude,
      1,
      0,
      undefined,
      stations.lats[0],
      stations.lons[0]
    );
    expect(expectedIntensity.pgvSurface).toBe(expectedWithoutSlab.pgvSurface);
  });

  it('should retain the legacy fallback for callers without raster data', () => {
    const rSlabPacific = calculateSlabFraction(40.0, 135.0, 350.0, 38.3, 141.0);
    expect(rSlabPacific).toBeGreaterThan(0.2);
  });

  it('should boost wave velocity along slab-dominated ray paths for deep events', () => {
    const hypoDeep = { lat: 40.0, lon: 135.0, depth: 350.0, magnitude: 7.0, originTime: 0.0 };
    const pacificLat = 38.3, pacificLon = 141.0;

    const rSlab = calculateSlabFraction(hypoDeep.lat, hypoDeep.lon, hypoDeep.depth, pacificLat, pacificLon);
    const tt = computeTravelTimes(hypoDeep, pacificLat, pacificLon, rSlab);

    expect(tt.vP).toBeGreaterThan(6.0); // Velocity boosted above baseline 6.0 km/s
    expect(tt.vS).toBeGreaterThan(3.5); // Velocity boosted above baseline 3.5 km/s

    // Slab path affects travel speed, not the removed attenuation heuristic.
    const pgvWithSlab = calculateBedrockPgv(tt.hypocentralDistance, hypoDeep.depth, hypoDeep.magnitude, rSlab);
    const pgvNoSlab = calculateBedrockPgv(tt.hypocentralDistance, hypoDeep.depth, hypoDeep.magnitude, 0.0);

    expect(pgvWithSlab).toBe(pgvNoSlab);
  });

  it('should increase average travel velocities for deep mantle paths', () => {
    const shallow = computeTravelTimes(
      { lat: 40, lon: 135, depth: 60, magnitude: 7, originTime: 0 },
      38,
      141
    );
    const deep = computeTravelTimes(
      { lat: 40, lon: 135, depth: 400, magnitude: 7, originTime: 0 },
      38,
      141
    );

    expect(shallow.vP).toBe(6.0);
    expect(shallow.vS).toBe(3.5);
    expect(deep.vP).toBeGreaterThan(shallow.vP);
    expect(deep.vP).toBeLessThan(8.0);
    expect(deep.vS).toBeGreaterThan(shallow.vS);
    expect(deep.vS).toBeLessThan(4.6);
  });
});
