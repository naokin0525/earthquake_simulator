/**
 * src/components/map/layers/MeshIntensityLayer.ts
 * ================================================
 * Custom WebGL Deck.gl TileLayer rendering real-time 250m mesh estimated seismic intensity maps
 * using a GPU fragment shader.
 */

import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';
import type { ShaderModule } from '@luma.gl/shadertools';
import { calculateEquivalentRuptureRadiusKm } from '../../../core/physics/finiteSource';
import { JMA_INTENSITY_LEVELS, hexToRgba } from '../../../core/ui/intensityColors';

export interface MeshIntensityLayerProps {
  id?: string;
  tileUrl?: string;
  hypoLat: number;
  hypoLon: number;
  depthKm: number;
  magnitude: number;
  visible?: boolean;
}

function shaderColor(scale: string, alpha: number): string {
  const colour = JMA_INTENSITY_LEVELS.find((level) => level.scale === scale)?.colour;
  if (!colour) throw new Error(`Missing color for JMA intensity "${scale}"`);
  const [red, green, blue] = hexToRgba(colour);
  return `vec4(${(red / 255).toFixed(6)}, ${(green / 255).toFixed(6)}, ${(blue / 255).toFixed(6)}, ${alpha.toFixed(2)})`;
}

export const MESH_INTENSITY_SHADER_DECLARATIONS = `
vec4 getJmaColor(float continuousI) {
  if (continuousI < 0.5) discard;
  if (continuousI < 1.5) return ${shaderColor('1', 0.70)};
  if (continuousI < 2.5) return ${shaderColor('2', 0.75)};
  if (continuousI < 3.5) return ${shaderColor('3', 0.80)};
  if (continuousI < 4.5) return ${shaderColor('4', 0.85)};
  if (continuousI < 5.0) return ${shaderColor('5-', 0.90)};
  if (continuousI < 5.5) return ${shaderColor('5+', 0.90)};
  if (continuousI < 6.0) return ${shaderColor('6-', 0.95)};
  if (continuousI < 6.5) return ${shaderColor('6+', 0.95)};
  return ${shaderColor('7', 1.00)};
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
float effectiveEpicentralDistanceKm = max(
  0.0,
  epicentralDistanceKm - meshIntensity.ruptureRadiusKm
);
float R = max(length(vec2(effectiveEpicentralDistanceKm, meshIntensity.depthKm)), 0.001);

float arv = 0.5 + (color.r * 2.5);
float saturationTerm = 0.0028 * pow(10.0, 0.50 * meshIntensity.magnitude);
float depthTerm = meshIntensity.depthKm <= 80.0
  ? 0.0038 * meshIntensity.depthKm
  : 0.304 + 0.304 * log(1.0 + (meshIntensity.depthKm - 80.0) / 80.0);
float log10Pgv600 = 0.58 * meshIntensity.magnitude + depthTerm + meshIntensity.faultTypeOffset - 1.29
  - log2(R + saturationTerm) * 0.30103 - 0.002 * R;
float bedrockPgv = pow(10.0, log10Pgv600);
float surfacePgv = bedrockPgv * max(0.5, arv);
float intensity = 2.68 + 1.72 * (log2(max(1e-6, surfacePgv)) * 0.30103);

color = getJmaColor(intensity);
`;

type MeshIntensityUniforms = {
  hypoCoords: [number, number];
  depthKm: number;
  magnitude: number;
  faultTypeOffset: number;
  ruptureRadiusKm: number;
  tileBounds: [number, number, number, number];
};

const meshIntensityUniforms: ShaderModule<MeshIntensityUniforms> = {
  name: 'meshIntensity',
  source: `
struct MeshIntensityUniforms {
  hypoCoords: vec2<f32>,
  depthKm: f32,
  magnitude: f32,
  faultTypeOffset: f32,
  ruptureRadiusKm: f32,
  tileBounds: vec4<f32>,
};
@group(0) @binding(auto) var<uniform> meshIntensity: MeshIntensityUniforms;
`,
  vs: `
layout(std140) uniform meshIntensityUniforms {
  vec2 hypoCoords;
  float depthKm;
  float magnitude;
  float faultTypeOffset;
  float ruptureRadiusKm;
  vec4 tileBounds;
} meshIntensity;
`,
  fs: `
layout(std140) uniform meshIntensityUniforms {
  vec2 hypoCoords;
  float depthKm;
  float magnitude;
  float faultTypeOffset;
  float ruptureRadiusKm;
  vec4 tileBounds;
} meshIntensity;
`,
  uniformTypes: {
    hypoCoords: 'vec2<f32>',
    depthKm: 'f32',
    magnitude: 'f32',
    faultTypeOffset: 'f32',
    ruptureRadiusKm: 'f32',
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
    const {
      hypoCoords,
      depthKm,
      magnitude,
      faultTypeOffset,
      ruptureRadiusKm,
      tileBounds
    } = this.props;
    this.state.model!.shaderInputs.setProps({
      meshIntensity: {
        hypoCoords,
        depthKm,
        magnitude,
        faultTypeOffset,
        ruptureRadiusKm,
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
  const faultTypeOffset = depthKm >= 60 ? 0.12 : depthKm >= 30 ? -0.02 : 0;
  const ruptureRadiusKm = calculateEquivalentRuptureRadiusKm(magnitude);

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
        textureParameters: {
          minFilter: 'nearest',
          magFilter: 'nearest'
        },
        hypoCoords: [hypoLat, hypoLon],
        depthKm,
        magnitude,
        faultTypeOffset,
        ruptureRadiusKm,
        tileBounds: [west, south, east, north]
      });
    },
    updateTriggers: {
      renderSubLayers: [hypoLat, hypoLon, depthKm, magnitude, visible]
    }
  });
}
