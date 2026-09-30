/**
 * src/components/map/layers/MeshIntensityLayer.ts
 * ================================================
 * Custom WebGL Deck.gl TileLayer rendering real-time 250m mesh estimated seismic intensity maps
 * using a GPU fragment shader.
 */

import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';

export interface MeshIntensityLayerProps {
  id?: string;
  tileUrl?: string;
  hypoLat: number;
  hypoLon: number;
  depthKm: number;
  magnitude: number;
  visible?: boolean;
}

const customFs = `
uniform vec2 u_hypo_coords; // [lat, lon]
uniform float u_depth_km;
uniform float u_magnitude;
uniform bool u_visible;

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

// Custom fragment shader injection for BitmapLayer
vec4 filterColor(vec4 color, float texCoord) {
  if (!u_visible || color.a < 0.1 || color.r < 0.01) {
    discard;
  }

  // Unpack ARV [0.5, 3.0] from R channel
  float arv = 0.5 + (color.r * 2.5);

  // Approximate continuous intensity formula from ARV and magnitude
  // Si & Midorikawa simplified GPU attenuation evaluation
  float R = 50.0; // Base distance approximation
  float saturationTerm = 0.0028 * pow(10.0, 0.50 * u_magnitude);
  float log10Pgv600 = 0.58 * u_magnitude + 0.0038 * u_depth_km - 1.29 - log2(R + saturationTerm) * 0.301 - 0.002 * R;
  float bedrockPgv = pow(10.0, log10Pgv600);
  float surfacePgv = bedrockPgv * max(0.1, arv);

  float I = 2.68 + 1.72 * (log2(max(1e-4, surfacePgv)) * 0.301);

  return getJmaColor(I);
}
`;

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

      return new BitmapLayer(subProps, {
        data: undefined,
        image: subProps.tile.layers ? undefined : subProps.tile.data,
        bounds: [west, south, east, north],
        _shaders: {
          inject: {
            'fs:DECKGL_FILTER_COLOR': customFs
          }
        },
        uniforms: {
          u_hypo_coords: [hypoLat, hypoLon],
          u_depth_km: depthKm,
          u_magnitude: magnitude,
          u_visible: visible
        }
      });
    },
    updateTriggers: {
      renderSubLayers: [hypoLat, hypoLon, depthKm, magnitude, visible]
    }
  });
}
