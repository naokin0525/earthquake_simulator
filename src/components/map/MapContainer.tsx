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

// Official JMA Seismic Intensity scale RGB colors
const INTENSITY_FILL_COLORS: Record<string, [number, number, number, number]> = {
  '7':  [184, 37, 247, 220],
  '6+': [151, 30, 39, 220],
  '6-': [234, 66, 37, 220],
  '5+': [223, 116, 44, 220],
  '5-': [232, 153, 57, 220],
  '4':  [246, 195, 68, 220],
  '3':  [104, 193, 249, 220],
  '2':  [198, 244, 205, 180],
  '1':  [140, 180, 210, 160],
  '0':  [35, 42, 35, 230]
};

// JMA Long-Period Ground Motion (LPGM) Class RGB colors
const LPGM_FILL_COLORS: Record<number, [number, number, number, number]> = {
  4: [147, 51, 234, 220],
  3: [239, 68, 68, 220],
  2: [249, 115, 22, 220],
  1: [59, 130, 246, 210]
};

export const MapContainer: React.FC = () => {
  const mapContainerRef = useRef<HTMLDivElement>(null);

  const [hoverInfo, setHoverInfo] = useState<any>(null);
  const [stationMetadataMap, setStationMetadataMap] = useState<Map<number, any>>(new Map());
  const [selectedStationIndex, setSelectedStationIndex] = useState<number | null>(null);

  const {
    stationBuffer,
    stationStates,
    triggerEventsMap,
    hypocenter,
    pRadiusKm,
    sRadiusKm,
    eewReport,
    flashReport,
    earthquakeInfoReport,
    lpgmReport,
    isKyoshinMonitor,
    isMeshVisible,
    mapVersion,
    hasEpicenter,
    mapDisplayMode,
    setHypocenter
  } = useSimulation();
  const hoveredObject = hoverInfo?.object;
  const hoveredStationIndex =
    typeof hoveredObject === 'number' && Number.isInteger(hoveredObject) ? hoveredObject : null;
  const hasValidStationHover =
    hoveredStationIndex !== null &&
    stationBuffer !== null &&
    hoveredStationIndex >= 0 &&
    hoveredStationIndex < stationBuffer.totalStations &&
    hoveredStationIndex < stationBuffer.lats.length &&
    hoveredStationIndex < stationBuffer.lons.length &&
    hoveredStationIndex < stationBuffer.ampFactors.length;
  const hasValidSelectedStation =
    selectedStationIndex !== null &&
    stationBuffer !== null &&
    selectedStationIndex >= 0 &&
    selectedStationIndex < stationBuffer.totalStations &&
    selectedStationIndex < stationBuffer.lats.length &&
    selectedStationIndex < stationBuffer.lons.length &&
    selectedStationIndex < stationBuffer.ampFactors.length;

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
      interactive: true
    });

    // Load station metadata for hover tooltips
    StationLoader.loadStations('/data/stations/stations.bin', '/data/stations/stations_meta.json')
      .then((dataSet) => {
        const metaMap = new Map<number, any>();
        for (const meta of dataSet.metadata) {
          metaMap.set(meta.index, meta);
        }
        setStationMetadataMap(metaMap);
      })
      .catch(() => { });

    return () => {
      map.remove();
    };
  }, [setHypocenter]);

  // 2. Build Deck.gl Layers
  const deckLayers = useMemo(() => {
    const layers: any[] = [];

    // Resolve effective display mode
    let effectiveMode = mapDisplayMode;
    if (effectiveMode === 'auto') {
      if (lpgmReport && lpgmReport.affectedPrefectures.length > 0) {
        effectiveMode = 'lpgm';
      } else if (earthquakeInfoReport) {
        effectiveMode = 'detail';
      } else if (flashReport) {
        effectiveMode = 'flash';
      } else if (eewReport) {
        effectiveMode = 'eew';
      } else {
        effectiveMode = 'off';
      }
    }

    // Build lookup maps for fast color resolution
    const eewMap = new Map<number, any>();
    if (eewReport) {
      for (const w of eewReport.warnedPrefectures) {
        eewMap.set(w.prefCode, w);
      }
    }

    const flashMap = new Map<number, string>();
    if (flashReport) {
      for (const p of flashReport.prefectures) {
        flashMap.set(p.prefCode, p.maxIntensity);
      }
    }

    const detailMap = new Map<number, string>();
    if (earthquakeInfoReport) {
      for (const p of earthquakeInfoReport.prefectures) {
        detailMap.set(p.prefCode, p.maxIntensity);
      }
    }

    const lpgmMap = new Map<number, number>();
    if (lpgmReport) {
      for (const p of lpgmReport.affectedPrefectures) {
        lpgmMap.set(p.prefCode, p.classLevel);
      }
    }

    // Layer 0: Japan Landmass with Dynamic Bulletin Coloring
    layers.push(
      new GeoJsonLayer({
        id: 'japan-landmass',
        data: '/data/prefectures.geojson',
        filled: true,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 45],
        getFillColor: (feature: any) => {
          const prefCode = feature.properties?.pref;
          if (!prefCode) return [44, 51, 41, 255];

          if (effectiveMode === 'eew') {
            const w = eewMap.get(prefCode);
            if (w?.isWarning) {
              // 警報対象地域: 鮮烈な警報色 (Red)
              return [220, 38, 38, 220];
            } else if (w?.isForecast) {
              // 予報対象地域: 予報色 (Orange/Amber)
              return [234, 153, 57, 180];
            }
            return [35, 42, 35, 240];
          }

          if (effectiveMode === 'flash') {
            const scale = flashMap.get(prefCode);
            if (scale) {
              return INTENSITY_FILL_COLORS[scale] ?? [35, 42, 35, 240];
            }
            return [35, 42, 35, 240];
          }

          if (effectiveMode === 'detail') {
            const scale = detailMap.get(prefCode);
            if (scale) {
              return INTENSITY_FILL_COLORS[scale] ?? [35, 42, 35, 240];
            }
            return [35, 42, 35, 240];
          }

          if (effectiveMode === 'lpgm') {
            const cls = lpgmMap.get(prefCode);
            if (cls) {
              return LPGM_FILL_COLORS[cls] ?? [35, 42, 35, 240];
            }
            return [35, 42, 35, 240];
          }

          // Default / off mode
          return [44, 51, 41, 255];
        },
        getLineColor: (feature: any) => {
          const prefCode = feature.properties?.pref;
          if (effectiveMode === 'eew') {
            const w = eewMap.get(prefCode);
            if (w?.isWarning) return [255, 255, 255, 255];
            if (w?.isForecast) return [254, 215, 170, 200];
            return [100, 116, 139, 120];
          }
          if (effectiveMode === 'flash') {
            const scale = flashMap.get(prefCode);
            if (scale) return [255, 255, 255, 240];
            return [100, 116, 139, 120];
          }
          if (effectiveMode === 'detail') {
            const scale = detailMap.get(prefCode);
            if (scale) return [255, 255, 255, 240];
            return [100, 116, 139, 120];
          }
          if (effectiveMode === 'lpgm') {
            const cls = lpgmMap.get(prefCode);
            if (cls) return [255, 255, 255, 240];
            return [100, 116, 139, 120];
          }
          return [255, 255, 255, 180];
        },
        getLineWidth: (feature: any) => {
          const prefCode = feature.properties?.pref;
          if (effectiveMode === 'eew') {
            const w = eewMap.get(prefCode);
            if (w?.isWarning) return 2.5;
            if (w?.isForecast) return 1.8;
          } else if (effectiveMode === 'flash' && flashMap.has(prefCode)) {
            return 2.0;
          } else if (effectiveMode === 'detail' && detailMap.has(prefCode)) {
            return 1.8;
          } else if (effectiveMode === 'lpgm' && lpgmMap.has(prefCode)) {
            return 2.0;
          }
          return 1.2;
        },
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 1.0,
        updateTriggers: {
          getFillColor: [
            effectiveMode,
            eewReport?.reportNumber,
            eewReport?.isWarning,
            flashReport?.issuedTime,
            earthquakeInfoReport?.issuedTime,
            lpgmReport?.issuedTime
          ],
          getLineColor: [
            effectiveMode,
            eewReport?.reportNumber,
            eewReport?.isWarning,
            flashReport?.issuedTime,
            earthquakeInfoReport?.issuedTime,
            lpgmReport?.issuedTime
          ],
          getLineWidth: [
            effectiveMode,
            eewReport?.reportNumber,
            eewReport?.isWarning,
            flashReport?.issuedTime,
            earthquakeInfoReport?.issuedTime,
            lpgmReport?.issuedTime
          ]
        }
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
          kyoshinMonitor: isKyoshinMonitor,
          mapVersion
        })
      );
    }

    // Layer 4: Hypocenters (True & EEW Estimated)
    const hypoLayers = createHypocenterLayers({
      hasEpicenter,
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
    flashReport,
    earthquakeInfoReport,
    lpgmReport,
    mapDisplayMode,
    isKyoshinMonitor,
    isMeshVisible,
    mapVersion,
    hasEpicenter
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
          if (info.layer?.id === 'stations-layer' && typeof info.object === 'number') {
            setSelectedStationIndex(info.object);
            return;
          }
          if (info.coordinate) {
            setSelectedStationIndex(null);
            setHypocenter(Math.round(info.coordinate[1] * 1000) / 1000, Math.round(info.coordinate[0] * 1000) / 1000);
          }
        }}
        onHover={setHoverInfo}
      />

      {hasValidSelectedStation && stationBuffer && selectedStationIndex !== null && (
        <section className="glass-panel station-detail" aria-live="polite" aria-label="選択した観測点">
          {(() => {
            const index = selectedStationIndex;
            const meta = stationMetadataMap.get(index);
            const event = triggerEventsMap.get(index);
            const state = stationStates[index] ?? 0;
            const intensity = event?.instrumentalIntensityScale ?? event?.intensity;
            const intensityNames: Record<string, string> = {
              '0': '0',
              '1': '1',
              '2': '2',
              '3': '3',
              '4': '4',
              '5-': '5弱',
              '5+': '5強',
              '6-': '6弱',
              '6+': '6強',
              '7': '7'
            };
            const intensityLabel = intensity
              ? intensityNames[intensity]
              : '未観測';
            const stateLabel = state === 2 ? 'S波到達' : state === 1 ? 'P波検知' : '平常';

            return (
              <>
                <div className="station-detail-header">
                  <div>
                    <strong>{meta?.name ?? `観測点 #${index}`}</strong>
                    {meta?.station_id && <span className="station-detail-id">{meta.station_id}</span>}
                  </div>
                  <button
                    type="button"
                    className="station-detail-close"
                    aria-label="観測点の詳細を閉じる"
                    onClick={() => setSelectedStationIndex(null)}
                  >
                    ×
                  </button>
                </div>
                <div>位置: {stationBuffer.lats[index].toFixed(3)}°, {stationBuffer.lons[index].toFixed(3)}°</div>
                <div>状態: {stateLabel} / {event?.instrumentalIntensityScale ? '計測震度' : '推定震度'}: {intensityLabel}</div>
                <div>地盤増幅率: {stationBuffer.ampFactors[index].toFixed(2)} / PGV: {event ? `${event.pgvSurface.toFixed(1)} cm/s` : '未観測'}</div>
              </>
            );
          })()}
        </section>
      )}

      {/* Station Hover Tooltip */}
      {hasValidStationHover && stationBuffer && hoveredStationIndex !== null && (
        <div
          className="glass-panel station-tooltip z-50 p-10 text-xs text-slate-100 rounded-lg shadow-xl pointer-events-none mb-2"
        >
          {(() => {
            const index = hoveredStationIndex;
            const meta = stationMetadataMap.get(index);
            const state = stationStates[index] ?? 0;
            const ev = triggerEventsMap.get(index);

            const name = meta ? meta.name : `観測点 #${index}`;
            const id = meta ? meta.station_id : '';
            const lat = stationBuffer.lats[index].toFixed(3);
            const lon = stationBuffer.lons[index].toFixed(3);
            const arv = stationBuffer.ampFactors[index].toFixed(2);
            const intensity = ev?.instrumentalIntensityScale ?? ev?.intensity;
            const intensityLabel = intensity === '5-' ? '5弱' :
              intensity === '5+' ? '5強' :
                intensity === '6-' ? '6弱' :
                  intensity === '6+' ? '6強' : intensity;

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
                    {ev.instrumentalIntensityScale ? '計測震度' : '推定震度'}: <span className="font-bold text-rose-400">{intensityLabel}</span> ({(ev.instrumentalIntensity ?? ev.continuousIntensity).toFixed(2)})
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
      {/* Prefecture Hover Tooltip */}
      {!hasValidStationHover && hoverInfo?.layer?.id === 'japan-landmass' && hoverInfo?.object?.properties && (
        <div
          className="glass-panel station-tooltip z-50 p-3 text-xs text-slate-100 rounded-lg shadow-xl pointer-events-none mb-2"
        >
          <div className="font-bold text-sm text-cyan-300 mb-1">
            {hoverInfo.object.properties.name}
          </div>
          {(() => {
            const prefCode = hoverInfo.object.properties.pref;
            const w = eewReport?.warnedPrefectures.find((p) => p.prefCode === prefCode);
            const flash = flashReport?.prefectures.find((p) => p.prefCode === prefCode);
            const detail = earthquakeInfoReport?.prefectures.find((p) => p.prefCode === prefCode);
            const lpgm = lpgmReport?.affectedPrefectures.find((p) => p.prefCode === prefCode);

            return (
              <div className="space-y-1">
                {w && (
                  <div>
                    EEW予測:{' '}
                    <span className={w.isWarning ? 'font-bold text-rose-400' : 'text-amber-300'}>
                      {w.isWarning ? '【警報】' : w.isForecast ? '【予報】' : '平常'} (予想震度 {w.maxPredictedIntensity})
                    </span>
                  </div>
                )}
                {flash && (
                  <div>
                    震度速報: <span className="font-bold text-yellow-400">震度 {flash.maxIntensity}</span>
                  </div>
                )}
                {detail && (
                  <div>
                    各地の震度: <span className="font-bold text-yellow-400">震度 {detail.maxIntensity}</span>
                  </div>
                )}
                {lpgm && (
                  <div>
                    長周期地震動: <span className="font-bold text-purple-400">階級 {lpgm.classLevel}</span>
                  </div>
                )}
                {!w && !flash && !detail && !lpgm && (
                  <div className="text-slate-400">発表情報なし</div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};
