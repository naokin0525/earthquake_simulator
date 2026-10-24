import { describe, expect, it } from 'vitest';
import {
  createMeshIntensityLayer,
  MESH_INTENSITY_FILTER_COLOR,
  MESH_INTENSITY_SHADER_DECLARATIONS
} from '../../src/components/map/layers/MeshIntensityLayer';

describe('mesh intensity layer attenuation', () => {
  it('uses each tile pixel coordinate and source coordinates for attenuation', () => {
    const layer = createMeshIntensityLayer({
      hypoLat: 35.5,
      hypoLon: 139.5,
      depthKm: 10,
      magnitude: 6.5
    });
    const renderSubLayers = layer.props.renderSubLayers;
    if (!renderSubLayers) {
      throw new Error('Mesh intensity tile sublayer renderer was not created');
    }

    const bounds = { west: 138, south: 34, east: 140, north: 36 };
    const subLayer = renderSubLayers({
      id: 'mesh-intensity-test-tile',
      data: {},
      _offset: 0,
      tile: { bbox: bounds, data: {} }
    } as Parameters<typeof renderSubLayers>[0]);

    expect(subLayer).not.toBeNull();
    if (!subLayer || Array.isArray(subLayer)) {
      throw new Error('Mesh intensity tile did not produce a bitmap layer');
    }

    expect(subLayer.props).toMatchObject({
      hypoCoords: [35.5, 139.5],
      tileBounds: [138, 34, 140, 36]
    });
    expect(MESH_INTENSITY_FILTER_COLOR).toContain('geometry.uv');
    expect(MESH_INTENSITY_FILTER_COLOR).toContain('getEpicentralDistanceKm(siteLat, siteLon)');
    expect(MESH_INTENSITY_SHADER_DECLARATIONS).toContain('meshIntensity.hypoCoords');
  });
});
