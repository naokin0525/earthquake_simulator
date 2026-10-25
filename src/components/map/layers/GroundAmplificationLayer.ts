import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';

const AMPLIFICATION_SHADER_DECLARATIONS = `
vec3 getAmplificationColor(float arv) {
  if (arv < 1.0) return mix(vec3(0.10, 0.45, 0.95), vec3(0.10, 0.85, 0.75), (arv - 0.5) / 0.5);
  if (arv < 1.5) return mix(vec3(0.10, 0.85, 0.75), vec3(0.95, 0.90, 0.20), (arv - 1.0) / 0.5);
  if (arv < 2.0) return mix(vec3(0.95, 0.90, 0.20), vec3(1.0, 0.48, 0.12), (arv - 1.5) / 0.5);
  return mix(vec3(1.0, 0.48, 0.12), vec3(0.90, 0.12, 0.16), clamp((arv - 2.0) / 1.0, 0.0, 1.0));
}
`;

const AMPLIFICATION_SHADER_FILTER = `
if (color.a < 0.1) {
  discard;
}
float arv = 0.5 + (color.r * 2.5);
color = vec4(getAmplificationColor(arv), color.a * 0.68);
`;

class GroundAmplificationBitmapLayer extends BitmapLayer {
  static layerName = 'GroundAmplificationBitmapLayer';

  getShaders() {
    const shaders = super.getShaders();
    shaders.inject = {
      ...shaders.inject,
      'fs:#decl': AMPLIFICATION_SHADER_DECLARATIONS,
      'fs:DECKGL_FILTER_COLOR': AMPLIFICATION_SHADER_FILTER
    };
    return shaders;
  }
}

export function createGroundAmplificationLayer(): TileLayer {
  return new TileLayer({
    id: 'ground-amplification-layer',
    data: '/tiles/mesh/{z}/{x}/{y}.png',
    minZoom: 5,
    maxZoom: 10,
    tileSize: 256,
    renderSubLayers: (subProps: any) => {
      const {
        bbox: { west, south, east, north }
      } = subProps.tile;

      return new GroundAmplificationBitmapLayer({
        id: subProps.id,
        image: subProps.tile.layers ? undefined : subProps.tile.data,
        bounds: [west, south, east, north],
        visible: subProps.visible,
        opacity: subProps.opacity,
        pickable: false,
        parameters: subProps.parameters
      });
    }
  });
}
