/**
 * src/components/map/layers/HypocenterLayer.ts
 * =============================================
 * Deck.gl layer rendering true and EEW estimated epicenters with pulsing crosshairs.
 */

import { ScatterplotLayer } from '@deck.gl/layers';
import { EEWReport, EarthquakeHypocenter } from '../../../core/types';

export interface HypocenterLayerProps {
  id?: string;
  trueHypocenter: EarthquakeHypocenter;
  eewReport?: EEWReport | null;
}

export function createHypocenterLayers(props: HypocenterLayerProps) {
  const { trueHypocenter, eewReport, id = 'hypocenter' } = props;
  const layers: any[] = [];

  // 1. True Hypocenter Marker
  layers.push(
    new ScatterplotLayer({
      id: `${id}-true-center`,
      data: [{ position: [trueHypocenter.lon, trueHypocenter.lat] }],
      getPosition: (d: any) => d.position,
      getFillColor: [255, 8, 68, 240], // Crimson red
      getLineColor: [255, 255, 255, 255],
      getRadius: 12000,
      radiusMinPixels: 8,
      radiusMaxPixels: 20,
      lineWidthMinPixels: 2,
      stroked: true,
      pickable: true
    })
  );

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
