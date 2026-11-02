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
import { BitmapLayer, GeoJsonLayer } from '@deck.gl/layers';
import { useSimulation } from '../../hooks/useSimulation';
import { createStationsLayer } from './layers/StationsLayer';
import { createWaveFrontLayers } from './layers/WaveFrontLayer';
import { createHypocenterLayers } from './layers/HypocenterLayer';
import {
  createMeshIntensityLayer
} from './layers/MeshIntensityLayer';
import { createGroundAmplificationLayer } from './layers/GroundAmplificationLayer';
import {
  createRegionIntensityLayers,
  getRegionIntensityMap,
  getReportedRegionIntensity,
  shouldShowRegionIntensityIcons,
  type AreaFeatureCollection
} from './layers/SubRegionLayer';
import { Slab2Model, type SlabDepthArea } from '../../core/physics/slabModel';
import { getJmaIntensityColor, hexToRgba, LPGM_INTENSITY_LEVELS } from '../../core/ui/intensityColors';
import { shouldIssueEstimatedIntensityDistribution } from '../../core/physics/attenuation';
import { computeWavefrontRadiusKm } from '../../core/physics/travelTime';

// Initial map view state focused on Japan
const INITIAL_VIEW_STATE = {
  latitude: 36.2,
  longitude: 138.2,
  zoom: 5.5,
  pitch: 0,
  bearing: 0
};
const REGION_INTENSITY_ZOOM_THRESHOLD = 7;

const LPGM_FILL_COLORS: Record<number, [number, number, number, number]> = Object.fromEntries(
  LPGM_INTENSITY_LEVELS.map(({ classLevel, colour }) => [
    classLevel,
    hexToRgba(colour, classLevel === 1 ? 210 : 220)
  ])
);

export const MapContainer: React.FC = () => {
  const mapContainerRef = useRef<HTMLDivElement>(null);

  const [hoverInfo, setHoverInfo] = useState<any>(null);
  const [selectedStationIndex, setSelectedStationIndex] = useState<number | null>(null);
  const [slabDepthAreas, setSlabDepthAreas] = useState<SlabDepthArea[]>([]);
  const [slabDepthAreasLoaded, setSlabDepthAreasLoaded] = useState(false);
  const [subRegions, setSubRegions] = useState<AreaFeatureCollection | null>(null);
  const [isRegionalIntensityZoomedIn, setIsRegionalIntensityZoomedIn] = useState(false);
  const [displaySimTime, setDisplaySimTime] = useState(0);
  const displayClockRef = useRef({ simTime: 0, timestamp: performance.now() });

  const {
    isPlaying,
    stationBuffer,
    stationStates,
    triggerEventsMap,
    hypocenter,
    simTime,
    timeScale,
    eewReport,
    flashReport,
    earthquakeInfoReport,
    lpgmReport,
    isKyoshinMonitor,
    ambientNoiseLevels,
    isMeshVisible,
    isFaultVisible,
    isArvVisible,
    stationMetadata,
    mapVersion,
    hasEpicenter,
    mapDisplayMode,
    setHypocenter
  } = useSimulation();
  useEffect(() => {
    displayClockRef.current = { simTime, timestamp: performance.now() };
    setDisplaySimTime(simTime);
  }, [simTime]);

  useEffect(() => {
    if (!isPlaying) return;
    let frameId = 0;
    const updateDisplayTime = () => {
      const { simTime: baseSimTime, timestamp } = displayClockRef.current;
      setDisplaySimTime(
        baseSimTime + ((performance.now() - timestamp) / 1000) * timeScale
      );
      frameId = requestAnimationFrame(updateDisplayTime);
    };
    frameId = requestAnimationFrame(updateDisplayTime);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, timeScale]);
  const stationMetadataMap = useMemo(
    () => new Map(stationMetadata.map((metadata) => [metadata.index, metadata])),
    [stationMetadata]
  );
  const stationIndices = useMemo(
    () => stationBuffer ? Array.from({ length: stationBuffer.totalStations }, (_, index) => index) : [],
    [stationBuffer]
  );
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

    return () => {
      map.remove();
    };
  }, [setHypocenter]);

  useEffect(() => {
    if (!isFaultVisible || slabDepthAreasLoaded) return;
    let cancelled = false;
    Slab2Model.load()
      .then((slabModel) => {
        if (!cancelled) {
          setSlabDepthAreas(slabModel.getDepthAreas());
          setSlabDepthAreasLoaded(true);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error('Failed to load filled slab depth areas', error);
      });
    return () => {
      cancelled = true;
    };
  }, [isFaultVisible, slabDepthAreasLoaded]);

  useEffect(() => {
    let cancelled = false;
    const loadSubRegions = async () => {
      const regionsResponse = await fetch('/data/sub_regions.geojson');
      if (!regionsResponse.ok) {
        throw new Error(`Failed to load JMA sub-regions: ${regionsResponse.status} ${regionsResponse.statusText}`);
      }

      const regions = await regionsResponse.json() as AreaFeatureCollection;
      if (!cancelled) setSubRegions(regions);
    };

    loadSubRegions().catch((error: unknown) => {
      if (!cancelled) console.error('Failed to load colored JMA sub-regions', error);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const slabAreaCanvases = useMemo(() => slabDepthAreas.map((area) => {
    const canvas = document.createElement('canvas');
    canvas.width = area.width;
    canvas.height = area.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create a canvas context for a slab depth area');
    const imageData = context.createImageData(area.width, area.height);
    imageData.data.set(area.pixels);
    context.putImageData(imageData, 0, 0);
    return { id: area.id, bounds: area.bounds, image: canvas };
  }), [slabDepthAreas]);

  const faultLayers = useMemo(
    () => isFaultVisible
      ? slabAreaCanvases.map((area) => new BitmapLayer({
          id: `slab-depth-area-${area.id}`,
          image: area.image,
          bounds: area.bounds,
          opacity: 0.8,
          pickable: false
        }))
      : [],
    [isFaultVisible, slabAreaCanvases]
  );
  const amplificationLayers = useMemo(
    () => isArvVisible ? [createGroundAmplificationLayer()] : [],
    [isArvVisible]
  );
  const waveLayers = useMemo(() => createWaveFrontLayers({
    trueHypocenter: hypocenter,
    currentTime: hypocenter.originTime + displaySimTime,
    pRadiusKm: computeWavefrontRadiusKm(displaySimTime, hypocenter.depth, 'P'),
    sRadiusKm: computeWavefrontRadiusKm(displaySimTime, hypocenter.depth, 'S'),
    eewReport
  }), [hypocenter, displaySimTime, eewReport]);
  const stationLayer = useMemo(() => stationBuffer
    ? createStationsLayer({
        stationBuffer,
        stationIndices,
        stationStates,
        triggerEventsMap,
        ambientNoiseLevels,
        kyoshinMonitor: isKyoshinMonitor,
        mapVersion,
        intensityDisplayMode: mapDisplayMode === 'auto' || mapDisplayMode === 'eew'
          ? 'current'
          : 'maximum'
      })
    : null, [
      stationBuffer,
      stationIndices,
      stationStates,
      triggerEventsMap,
      ambientNoiseLevels,
      isKyoshinMonitor,
      mapVersion,
      mapDisplayMode
    ]);

  const effectiveMode = useMemo(() => {
    if (mapDisplayMode !== 'auto') return mapDisplayMode;
    if (lpgmReport && lpgmReport.affectedPrefectures.length > 0) return 'lpgm';
    if (earthquakeInfoReport) return 'estimated';
    if (flashReport) return 'flash';
    if (eewReport) return 'eew';
    return 'off';
  }, [mapDisplayMode, lpgmReport, earthquakeInfoReport, flashReport, eewReport]);
  const estimatedDistributionIssued = shouldIssueEstimatedIntensityDistribution(
    earthquakeInfoReport?.maxIntensity
  );
  const landmassLayer = useMemo(() => {
    const eewMap = new Map<number, any>();
    if (eewReport) {
      for (const warning of eewReport.warnedPrefectures) {
        eewMap.set(warning.prefCode, warning);
      }
    }

    const flashRegionMap = getRegionIntensityMap(flashReport);
    const detailRegionMap = getRegionIntensityMap(earthquakeInfoReport);
    const activeRegionIntensityMap = effectiveMode === 'flash'
      ? flashRegionMap
      : effectiveMode === 'detail'
        ? detailRegionMap
        : new Map();
    const lpgmMap = new Map<number, number>();
    if (lpgmReport) {
      for (const prefecture of lpgmReport.affectedPrefectures) {
        lpgmMap.set(prefecture.prefCode, prefecture.classLevel);
      }
    }

    return new GeoJsonLayer({
      id: 'japan-landmass',
      data: subRegions ?? [],
      filled: true,
      pickable: true,
      autoHighlight: true,
      lineJointRounded: true,
      lineCapRounded: true,
      highlightColor: [255, 255, 255, 45],
      getFillColor: (feature: any) => {
        const prefCode = feature.properties?.pref;

        if (effectiveMode === 'eew') {
          const warning = eewMap.get(prefCode);
          if (warning?.isWarning) return [220, 38, 38, 220];
          if (warning?.isForecast) return [234, 153, 57, 180];
          return [35, 42, 35, 240];
        }

        if (effectiveMode === 'flash' || effectiveMode === 'detail') {
          const scale = getReportedRegionIntensity(feature, activeRegionIntensityMap);
          return scale
            ? getJmaIntensityColor(scale, scale === '0' ? 70 : 85)
            : [35, 42, 35, 240];
        }

        if (effectiveMode === 'lpgm') {
          const classLevel = lpgmMap.get(prefCode);
          return classLevel
            ? LPGM_FILL_COLORS[classLevel] ?? [35, 42, 35, 240]
            : [35, 42, 35, 240];
        }
        return [44, 51, 41, 255];
      },
      getLineColor: (feature: any) => {
        const prefCode = feature.properties?.pref;
        if (effectiveMode === 'eew') {
          const warning = eewMap.get(prefCode);
          if (warning?.isWarning) return [255, 255, 255, 255];
          if (warning?.isForecast) return [254, 215, 170, 200];
          return [100, 116, 139, 120];
        }
        if (effectiveMode === 'flash' || effectiveMode === 'detail') {
          return getReportedRegionIntensity(feature, activeRegionIntensityMap)
            ? [255, 255, 255, 240]
            : [100, 116, 139, 120];
        }
        if (effectiveMode === 'lpgm') {
          return lpgmMap.has(prefCode)
            ? [255, 255, 255, 240]
            : [100, 116, 139, 120];
        }
        return [255, 255, 255, 180];
      },
      getLineWidth: (feature: any) => {
        const prefCode = feature.properties?.pref;
        if (effectiveMode === 'eew') {
          const warning = eewMap.get(prefCode);
          if (warning?.isWarning) return 2.5;
          if (warning?.isForecast) return 1.8;
        } else if (
          (effectiveMode === 'flash' || effectiveMode === 'detail') &&
          getReportedRegionIntensity(feature, activeRegionIntensityMap)
        ) {
          return effectiveMode === 'flash' ? 2 : 1.8;
        } else if (effectiveMode === 'lpgm' && lpgmMap.has(prefCode)) {
          return 2;
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
    });
  }, [subRegions, effectiveMode, eewReport, flashReport, earthquakeInfoReport, lpgmReport]);

  const meshLayer = useMemo(() => {
    const shouldRenderMesh = effectiveMode === 'estimated'
      ? estimatedDistributionIssued
      : isMeshVisible;
    if (!shouldRenderMesh) return null;
    return createMeshIntensityLayer({
      hypoLat: hypocenter.lat,
      hypoLon: hypocenter.lon,
      depthKm: hypocenter.depth,
      magnitude: hypocenter.magnitude,
      visible: true
    });
  }, [effectiveMode, estimatedDistributionIssued, isMeshVisible, hypocenter]);
  const hypocenterLayers = useMemo(
    () => createHypocenterLayers({ hasEpicenter, trueHypocenter: hypocenter, eewReport }),
    [hasEpicenter, hypocenter, eewReport]
  );
  const regionalReport = mapDisplayMode === 'flash'
    ? flashReport
    : mapDisplayMode === 'detail'
      ? earthquakeInfoReport
      : null;
  const regionalIntensityLayers = useMemo(
    () => shouldShowRegionIntensityIcons(mapDisplayMode, isRegionalIntensityZoomedIn)
      ? createRegionIntensityLayers(subRegions, regionalReport)
      : [],
    [mapDisplayMode, isRegionalIntensityZoomedIn, subRegions, regionalReport]
  );

  // 2. Compose independently memoized Deck.gl layer groups.
  const deckLayers = useMemo(() => [
    landmassLayer,
    ...faultLayers,
    ...amplificationLayers,
    ...(meshLayer ? [meshLayer] : []),
    ...waveLayers,
    ...(stationLayer ? [stationLayer] : []),
    ...hypocenterLayers,
    ...regionalIntensityLayers
  ], [
    landmassLayer,
    faultLayers,
    amplificationLayers,
    meshLayer,
    waveLayers,
    stationLayer,
    hypocenterLayers,
    regionalIntensityLayers
  ]);

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* MapLibre Container */}
      <div ref={mapContainerRef} className="absolute inset-0 w-full h-full" />

      {/* Deck.gl Overlay Canvas */}
      <DeckGL
        initialViewState={INITIAL_VIEW_STATE}
        controller={true}
        useDevicePixels={true}
        layers={deckLayers}
        style={{ position: 'absolute', top: '0px', left: '0px', width: '100%', height: '100%' }}
        onViewStateChange={({ viewState }) => {
          if ('zoom' in viewState) {
            setIsRegionalIntensityZoomedIn(viewState.zoom >= REGION_INTENSITY_ZOOM_THRESHOLD);
          }
        }}
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

            let stateText = '平常';
            if (state === 1) stateText = 'P波検知';
            if (state === 2) stateText = 'S波到達';

            return (
              <div className="space-y-1">
                <div className="font-bold text-sm text-cyan-300">
                  {name} <span className="text-slate-400 font-normal">({id})</span>
                </div>
                <div>位置: 北緯 {lat}° / 東経 {lon}°</div>
                <div>地盤増幅率: <span className="font-semibold text-yellow-400">{arv}</span></div>
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
                      {w.isWarning ? '【警報】' : w.isForecast ? '【予報】' : '平常'} (予想震度 {w.maxPredictedIntensity}
                      {w.maxPredictedLpgmClass > 0 ? ` / 長周期階級${w.maxPredictedLpgmClass}` : ''})
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
