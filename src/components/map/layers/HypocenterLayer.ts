/**
 * src/components/map/layers/HypocenterLayer.ts
 * =============================================
 * Deck.gl layer rendering true and EEW estimated epicenters with pulsing crosshairs.
 */

import { IconLayer, ScatterplotLayer } from '@deck.gl/layers';
import { EEWReport, EarthquakeHypocenter } from '../../../core/types';

export interface HypocenterLayerProps {
  id?: string;
  hasEpicenter: boolean;
  trueHypocenter: EarthquakeHypocenter;
  eewReport?: EEWReport | null;
}

export function createHypocenterLayers(props: HypocenterLayerProps) {
  const { hasEpicenter, trueHypocenter, eewReport, id = 'hypocenter' } = props;
  const layers: any[] = [];

  if (hasEpicenter) {
    layers.push(
      new IconLayer({
        id: `${id}-true-center`,
        data: [{ position: [trueHypocenter.lon, trueHypocenter.lat] }],
        getPosition: (d: any) => d.position,
        getIcon: () => ({
          url: '/logo/epicenter.svg',
          width: 64,
          height: 64,
          anchorY: 32
        }),
        sizeScale: 1,
        sizeUnits: 'pixels',
        getSize: 32,
        pickable: false
      })
    );
  }

  // 2. EEW Estimated Hypocenter Marker
  if (eewReport && eewReport.estimatedHypocenter) {
    const est = eewReport.estimatedHypocenter;
    layers.push(
      new ScatterplotLayer({
        id: `${id}-est-center`,
        data: [{ position: [est.lon, est.lat] }],
        getPosition: (d: any) => d.position,
        getFillColor: [255, 200, 0, 240], // Neon yellow
        getLineColor: [0, 0, 0, 240],
        getRadius: 10000,
        radiusMinPixels: 7,
        radiusMaxPixels: 16,
        lineWidthMinPixels: 2,
        stroked: true,
        pickable: true
      })
    );
  }

  return layers;
}
