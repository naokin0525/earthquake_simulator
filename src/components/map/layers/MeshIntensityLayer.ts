/**
 * src/components/map/layers/MeshIntensityLayer.ts
 * ================================================
 * Custom WebGL Deck.gl TileLayer rendering real-time 250m mesh estimated seismic intensity maps
 * using a GPU fragment shader.
 */

import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';
import type { ShaderModule } from '@luma.gl/shadertools';

export interface MeshIntensityLayerProps {
  id?: string;
  tileUrl?: string;
  hypoLat: number;
  hypoLon: number;
  depthKm: number;
  magnitude: number;
  visible?: boolean;
}

export const MESH_INTENSITY_SHADER_DECLARATIONS = `
vec4 getJmaColor(float continuousI) {
  if (continuousI < 0.5) discard;
  if (continuousI < 1.5) return vec4(0.29, 0.59, 0.84, 0.60); // 1
  if (continuousI < 2.5) return vec4(0.06, 0.31, 0.62, 0.75); // 2
  if (continuousI < 3.5) return vec4(0.12, 0.51, 0.30, 0.80); // 3
  if (continuousI < 4.5) return vec4(0.95, 0.77, 0.06, 0.85); // 4
  if (continuousI < 5.0) return vec4(0.95, 0.61, 0.07, 0.90); // 5-
  if (continuousI < 5.5) return vec4(0.90, 0.49, 0.13, 0.90); // 5+
  if (continuousI < 6.0) return vec4(0.91, 0.30, 0.24, 0.95); // 6-
  if (continuousI < 6.5) return vec4(0.75, 0.22, 0.17, 0.95); // 6+
  return vec4(0.56, 0.27, 0.68, 1.00);                       // 7
}

float getEpicentralDistanceKm(float siteLat, float siteLon) {
  const float earthRadiusKm = 6371.0088;
  float lat1 = radians(meshIntensity.hypoCoords.x);
  float lat2 = radians(siteLat);
  float dLat = lat2 - lat1;
  float dLon = radians(siteLon - meshIntensity.hypoCoords.y);
  float sinHalfLat = sin(dLat * 0.5);
  float sinHalfLon = sin(dLon * 0.5);
  float haversine = sinHalfLat * sinHalfLat +
    cos(lat1) * cos(lat2) * sinHalfLon * sinHalfLon;
  return 2.0 * earthRadiusKm * asin(sqrt(clamp(haversine, 0.0, 1.0)));
}
`;

export const MESH_INTENSITY_FILTER_COLOR = `
if (color.a < 0.1 || color.r < 0.01) {
  discard;
}

float siteLon = mix(meshIntensity.tileBounds.x, meshIntensity.tileBounds.z, geometry.uv.x);
float siteLat = mix(meshIntensity.tileBounds.w, meshIntensity.tileBounds.y, geometry.uv.y);
float epicentralDistanceKm = getEpicentralDistanceKm(siteLat, siteLon);
float R = max(length(vec2(epicentralDistanceKm, meshIntensity.depthKm)), 0.001);

float arv = 0.5 + (color.r * 2.5);
float saturationTerm = 0.0028 * pow(10.0, 0.50 * meshIntensity.magnitude);
float log10Pgv600 = 0.58 * meshIntensity.magnitude + 0.0038 * meshIntensity.depthKm - 1.29
  - log2(R + saturationTerm) * 0.301 - 0.002 * R;
float bedrockPgv = pow(10.0, log10Pgv600);
float surfacePgv = bedrockPgv * max(0.1, arv);
float intensity = 2.68 + 1.72 * (log2(max(1e-4, surfacePgv)) * 0.301);

color = getJmaColor(intensity);
`;

type MeshIntensityUniforms = {
  hypoCoords: [number, number];
  depthKm: number;
  magnitude: number;
  tileBounds: [number, number, number, number];
};

const meshIntensityUniforms: ShaderModule<MeshIntensityUniforms> = {
  name: 'meshIntensity',
  source: `
struct MeshIntensityUniforms {
  hypoCoords: vec2<f32>,
  depthKm: f32,
  magnitude: f32,
  tileBounds: vec4<f32>,
};
@group(0) @binding(auto) var<uniform> meshIntensity: MeshIntensityUniforms;
`,
  vs: `
layout(std140) uniform meshIntensityUniforms {
  vec2 hypoCoords;
  float depthKm;
  float magnitude;
  vec4 tileBounds;
} meshIntensity;
`,
  fs: `
layout(std140) uniform meshIntensityUniforms {
  vec2 hypoCoords;
  float depthKm;
  float magnitude;
  vec4 tileBounds;
} meshIntensity;
`,
  uniformTypes: {
    hypoCoords: 'vec2<f32>',
    depthKm: 'f32',
    magnitude: 'f32',
    tileBounds: 'vec4<f32>'
  }
};

type MeshIntensityBitmapProps = MeshIntensityUniforms;

class MeshIntensityBitmapLayer extends BitmapLayer<MeshIntensityBitmapProps> {
  static layerName = 'MeshIntensityBitmapLayer';

  getShaders() {
    const shaders = super.getShaders();
    shaders.modules = [...shaders.modules, meshIntensityUniforms];
    shaders.inject = {
      ...shaders.inject,
      'fs:#decl': MESH_INTENSITY_SHADER_DECLARATIONS,
      'fs:DECKGL_FILTER_COLOR': MESH_INTENSITY_FILTER_COLOR
    };
    return shaders;
  }

  draw(params: Parameters<BitmapLayer['draw']>[0]) {
    const { hypoCoords, depthKm, magnitude, tileBounds } = this.props;
    this.state.model!.shaderInputs.setProps({
      meshIntensity: {
        hypoCoords,
        depthKm,
        magnitude,
        tileBounds
      }
    });
    super.draw(params);
  }
}

export function createMeshIntensityLayer(props: MeshIntensityLayerProps): TileLayer {
  const {
    hypoLat,
    hypoLon,
    depthKm,
    magnitude,
    visible = true,
    tileUrl = '/tiles/mesh/{z}/{x}/{y}.png',
    id = 'mesh-intensity-layer'
  } = props;

  return new TileLayer({
    id,
    data: tileUrl,
    minZoom: 5,
    maxZoom: 10,
    tileSize: 256,
    visible,
    renderSubLayers: (subProps: any) => {
      const {
        bbox: { west, south, east, north }
      } = subProps.tile;

      return new MeshIntensityBitmapLayer({
        id: subProps.id,
        image: subProps.tile.layers ? undefined : subProps.tile.data,
        bounds: [west, south, east, north],
        visible,
        opacity: subProps.opacity,
        pickable: subProps.pickable,
        parameters: subProps.parameters,
        hypoCoords: [hypoLat, hypoLon],
        depthKm,
        magnitude,
        tileBounds: [west, south, east, north]
      });
    },
    updateTriggers: {
      renderSubLayers: [hypoLat, hypoLon, depthKm, magnitude, visible]
    }
  });
}
