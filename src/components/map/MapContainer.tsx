/**
 * src/components/map/MapContainer.tsx
 * ====================================
 * High-performance MapLibre GL JS + Deck.gl map canvas container.
 * Integrates PMTiles administrative boundaries, seismograph stations, dual wavefronts,
 * and custom WebGL 250m mesh intensity shader overlay.
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import DeckGL from '@deck.gl/react';
import { GeoJsonLayer } from '@deck.gl/layers';
import { useSimulation } from '../../hooks/useSimulation';
import { createStationsLayer } from './layers/StationsLayer';
import { createWaveFrontLayers } from './layers/WaveFrontLayer';
import { createHypocenterLayers } from './layers/HypocenterLayer';
import { createMeshIntensityLayer } from './layers/MeshIntensityLayer';
import { StationLoader } from '../../loaders/StationLoader';

// Initial map view state focused on Japan
const INITIAL_VIEW_STATE = {
  latitude: 36.2,
  longitude: 138.2,
  zoom: 5.5,
  pitch: 0,
  bearing: 0
};

export const MapContainer: React.FC = () => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const [hoverInfo, setHoverInfo] = useState<any>(null);
  const [stationMetadataMap, setStationMetadataMap] = useState<Map<number, any>>(new Map());

  const {
    stationBuffer,
    stationStates,
    triggerEventsMap,
    hypocenter,
    pRadiusKm,
    sRadiusKm,
    eewReport,
    isMeshVisible,
    setHypocenter
  } = useSimulation();

  // 1. Initialize MapLibre GL
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {},
        layers: []
      },
      center: [INITIAL_VIEW_STATE.longitude, INITIAL_VIEW_STATE.latitude],
      zoom: INITIAL_VIEW_STATE.zoom,
      attributionControl: false,
      interactive: false
    });

    mapRef.current = map;

    // Load station metadata for hover tooltips
    StationLoader.loadStations('/data/stations/stations.bin', '/data/stations/stations_meta.json')
      .then((dataSet) => {
        const metaMap = new Map<number, any>();
        for (const meta of dataSet.metadata) {
          metaMap.set(meta.index, meta);
        }
        setStationMetadataMap(metaMap);
      })
      .catch(() => {});

    // Handle map click to reposition hypocenter
    map.on('click', (e) => {
      setHypocenter(
        Math.round(e.lngLat.lat * 1000) / 1000,
        Math.round(e.lngLat.lng * 1000) / 1000
      );
    });

    return () => {
      map.remove();
    };
  }, [setHypocenter]);

  // 2. Build Deck.gl Layers
  const deckLayers = useMemo(() => {
    const layers: any[] = [];

    // Layer 0: Local Japan Landmass (GeoJSON)
    layers.push(
      new GeoJsonLayer({
        id: 'japan-landmass',
        data: '/data/prefectures.geojson',
        filled: true,
        getFillColor: [17, 24, 39, 255],
        getLineColor: [255, 255, 255, 200],
        lineWidthMinPixels: 1.5,
      })
    );

    // Layer 1: Custom WebGL 250m Mesh Intensity Shader Layer (if toggled)
    if (isMeshVisible) {
      layers.push(
        createMeshIntensityLayer({
          hypoLat: hypocenter.lat,
          hypoLon: hypocenter.lon,
          depthKm: hypocenter.depth,
          magnitude: hypocenter.magnitude,
          visible: isMeshVisible
        })
      );
    }

    // Layer 2: Dual Wave Fronts (Ground Truth & EEW Estimated)
    const waveLayers = createWaveFrontLayers({
      trueHypocenter: hypocenter,
      pRadiusKm,
      sRadiusKm,
      eewReport
    });
    layers.push(...waveLayers);

    // Layer 3: Seismograph Stations (1,749 stations)
    if (stationBuffer) {
      layers.push(
        createStationsLayer({
          stationBuffer,
          stationStates,
          triggerEventsMap,
          onHover: (info) => setHoverInfo(info)
        })
      );
    }

    // Layer 4: Hypocenters (True & EEW Estimated)
    const hypoLayers = createHypocenterLayers({
      trueHypocenter: hypocenter,
      eewReport
    });
    layers.push(...hypoLayers);

    return layers;
  }, [
    stationBuffer,
    stationStates,
    triggerEventsMap,
    hypocenter,
    pRadiusKm,
    sRadiusKm,
    eewReport,
    isMeshVisible
  ]);

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* MapLibre Container */}
      <div ref={mapContainerRef} className="absolute inset-0 w-full h-full" />

      {/* Deck.gl Overlay Canvas */}
      <DeckGL
        initialViewState={INITIAL_VIEW_STATE}
        controller={true}
        layers={deckLayers}
        style={{ position: 'absolute', top: '0px', left: '0px', width: '100%', height: '100%' }}
        onClick={(info) => {
          if (info.coordinate) {
            setHypocenter(Math.round(info.coordinate[1] * 1000) / 1000, Math.round(info.coordinate[0] * 1000) / 1000);
          }
        }}
      />

      {/* Station Hover Tooltip */}
      {hoverInfo && hoverInfo.object !== undefined && (
        <div
          className="glass-panel absolute z-50 p-3 text-xs text-slate-100 rounded-lg shadow-xl pointer-events-none transform -translate-x-1/2 -translate-y-full mb-2"
          style={{ left: hoverInfo.x, top: hoverInfo.y }}
        >
          {(() => {
            const index = hoverInfo.object;
            const meta = stationMetadataMap.get(index);
            const state = stationStates[index] ?? 0;
            const ev = triggerEventsMap.get(index);

            const name = meta ? meta.name : `観測点 #${index}`;
            const id = meta ? meta.station_id : '';
            const lat = stationBuffer?.lats[index].toFixed(3);
            const lon = stationBuffer?.lons[index].toFixed(3);
            const arv = stationBuffer?.ampFactors[index].toFixed(2);

            let stateText = '平常 (IDLE)';
            if (state === 1) stateText = 'P波検知 (P_TRIGGERED)';
            if (state === 2) stateText = 'S波到達 (S_ARRIVED)';

            return (
              <div className="space-y-1">
                <div className="font-bold text-sm text-cyan-300">
                  {name} <span className="text-slate-400 font-normal">({id})</span>
                </div>
                <div>位置: 北緯 {lat}° / 東経 {lon}°</div>
                <div>地盤増幅率 (ARV): <span className="font-semibold text-yellow-400">{arv}</span></div>
                <div>状態: <span className="font-semibold text-amber-300">{stateText}</span></div>
                {ev && (
                  <div>
                    計測震度: <span className="font-bold text-rose-400">{ev.intensity}</span> ({ev.continuousIntensity.toFixed(2)})
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};
