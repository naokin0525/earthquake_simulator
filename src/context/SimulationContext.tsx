/**
 * src/context/SimulationContext.tsx
 * =================================
 * React Context bridging UI state with the high-performance simulation Web Worker.
 */

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import {
  EEWReport,
  EarthquakeHypocenter,
  SimulationTickState,
  StationDataBuffer,
  StationState,
  StationTriggerEvent,
  WorkerInboundAction,
  WorkerOutboundEvent,
  IntensityFlashReport,
  EarthquakeInfoReport,
  LPGMReport,
  SimulationMilestone
} from '../core/types';
import {
  createSimulationConfig,
  DEFAULT_HYPOCENTER,
  shouldPlayEewWarningChime
} from '../core/simulationState';
import { generateAmbientNoiseLevels } from '../core/utils/colorUtils';
import { formatEewWarningAnnouncement } from '../core/ui/EEWFormatter';
import { StationLoader } from '../loaders/StationLoader';
import { computeAmpFactorsFromTiles } from '../loaders/AmpFactorTileLoader';
import { preloadMeshTiles, type MeshTileLoadProgress } from '../loaders/MeshTileLoader';
import { loadDailyNoise } from '../loaders/NoiseLoader';
import { audioAlertSystem } from '../utils/audioAlert';

export type MapDisplayMode = 'auto' | 'eew' | 'flash' | 'detail' | 'lpgm' | 'off';
export type StartupPhase = 'tiles' | 'stations' | 'worker';

interface SimulationContextValue {
  isReady: boolean;
  startupPhase: StartupPhase;
  startupProgress: MeshTileLoadProgress;
  startupError: string | null;
  retryStartup: () => void;
  isPlaying: boolean;
  simTime: number;
  pRadiusKm: number;
  sRadiusKm: number;
  timeScale: number;
  hypocenter: EarthquakeHypocenter;
  stationBuffer: StationDataBuffer | null;
  stationStates: Uint8Array;
  triggerEventsMap: Map<number, StationTriggerEvent>;
  eewReport: EEWReport | null;
  flashReport: IntensityFlashReport | null;
  earthquakeInfoReport: EarthquakeInfoReport | null;
  lpgmReport: LPGMReport | null;
  milestones: SimulationMilestone[];
  isMeshVisible: boolean;
  fps: number;
  isMuted: boolean;
  isSpeechEnabled: boolean;
  isSpeechSupported: boolean;
  isKyoshinMonitor: boolean;
  ambientNoiseLevels: Float32Array | null;
  ambientNoiseUpdatedAt: number | null;
  mapVersion: number;
  hasEpicenter: boolean;
  mapDisplayMode: MapDisplayMode;
  isFaultVisible: boolean;
  isArvVisible: boolean;

  // Actions
  setHypocenter: (lat: number, lon: number) => void;
  setDepth: (depthKm: number) => void;
  setMagnitude: (mw: number) => void;
  setTimeScale: (speed: number) => void;
  toggleMeshVisible: () => void;
  toggleFaultVisible: () => void;
  toggleArvVisible: () => void;
  play: () => void;
  pause: () => void;
  reset: () => void;
  seek: (time: number) => void;
  toggleMute: () => void;
  toggleSpeech: () => void;
  toggleKyoshinMonitor: () => void;
  setMapDisplayMode: (mode: MapDisplayMode) => void;
  jumpToTime: (targetTime: number) => void;
}

const SimulationContext = createContext<SimulationContextValue | null>(null);

export const SimulationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const workerRef = useRef<Worker | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [startupPhase, setStartupPhase] = useState<StartupPhase>('tiles');
  const [startupProgress, setStartupProgress] = useState<MeshTileLoadProgress>({ completed: 0, total: 0 });
  const [startupError, setStartupError] = useState<string | null>(null);
  const [startupAttempt, setStartupAttempt] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [simTime, setSimTime] = useState(0.0);
  const [pRadiusKm, setPRadiusKm] = useState(0.0);
  const [sRadiusKm, setSRadiusKm] = useState(0.0);
  const [timeScale, setTimeScaleState] = useState(1.0);
  const [hypocenter, setHypocenterState] = useState<EarthquakeHypocenter>(DEFAULT_HYPOCENTER);
  const [stationBuffer, setStationBuffer] = useState<StationDataBuffer | null>(null);
  const [eewReport, setEewReport] = useState<EEWReport | null>(null);
  const [flashReport, setFlashReport] = useState<IntensityFlashReport | null>(null);
  const [earthquakeInfoReport, setEarthquakeInfoReport] = useState<EarthquakeInfoReport | null>(null);
  const [lpgmReport, setLpgmReport] = useState<LPGMReport | null>(null);
  const [milestones, setMilestones] = useState<SimulationMilestone[]>([]);
  const [isMeshVisible, setIsMeshVisible] = useState(false);
  const [isFaultVisible, setIsFaultVisible] = useState(true);
  const [isArvVisible, setIsArvVisible] = useState(false);
  const [isKyoshinMonitor, setIsKyoshinMonitor] = useState(false);
  const [ambientNoiseLevels, setAmbientNoiseLevels] = useState<Float32Array | null>(null);
  const [ambientNoiseUpdatedAt, setAmbientNoiseUpdatedAt] = useState<number | null>(null);
  const [mapVersion, setMapVersion] = useState(0);
  const [hasEpicenter, setHasEpicenter] = useState(false);
  const [mapDisplayMode, setMapDisplayMode] = useState<MapDisplayMode>('auto');
  const [fps, setFps] = useState(60);
  const [isMuted, setIsMuted] = useState(audioAlertSystem.getMuted());
  const [isSpeechEnabled, setIsSpeechEnabled] = useState(audioAlertSystem.getSpeechEnabled());
  const isSpeechSupported = audioAlertSystem.canSpeak();

  const stationStatesRef = useRef<Uint8Array>(new Uint8Array(0));
  const triggerEventsMapRef = useRef<Map<number, StationTriggerEvent>>(new Map());
  const eewReportRef = useRef<EEWReport | null>(null);

  useEffect(() => {
    const populationDensities = stationBuffer?.dailyNoise;
    if (!isKyoshinMonitor || !populationDensities) {
      setAmbientNoiseLevels(null);
      setAmbientNoiseUpdatedAt(null);
      return;
    }

    const updateAmbientNoise = () => {
      setAmbientNoiseLevels(generateAmbientNoiseLevels(populationDensities));
      setAmbientNoiseUpdatedAt(Date.now());
    };

    updateAmbientNoise();
    const timer = setInterval(updateAmbientNoise, 1000);
    return () => clearInterval(timer);
  }, [isKyoshinMonitor, stationBuffer]);

  const clearReportState = useCallback(() => {
    eewReportRef.current = null;
    setEewReport(null);
    setFlashReport(null);
    setEarthquakeInfoReport(null);
    setLpgmReport(null);
    setMilestones([]);
  }, []);

  // FPS Counter
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(performance.now());

  const updateFps = useCallback(() => {
    frameCountRef.current++;
    const now = performance.now();
    if (now - lastFpsTimeRef.current >= 1000) {
      setFps(Math.round((frameCountRef.current * 1000) / (now - lastFpsTimeRef.current)));
      frameCountRef.current = 0;
      lastFpsTimeRef.current = now;
    }
  }, []);

  const handleWorkerMessage = useCallback((event: MessageEvent<WorkerOutboundEvent>) => {
    const msg = event.data;

    switch (msg.type) {
      case 'READY':
        setStartupPhase('worker');
        setIsReady(true);
        break;

      case 'ERROR':
        console.error('[SimulationContext] Simulation worker error:', msg.payload.message);
        setStartupError(`Simulation worker failed: ${msg.payload.message}`);
        setIsReady(false);
        break;

      case 'TICK': {
        const tick: SimulationTickState = msg.payload;
        setSimTime(tick.simTime);
        setPRadiusKm(tick.pWaveRadiusKm);
        setSRadiusKm(tick.sWaveRadiusKm);

        for (const ev of tick.newTriggers) {
          stationStatesRef.current[ev.stationIndex] = ev.state;
          triggerEventsMapRef.current.set(ev.stationIndex, ev);
        }

        if (tick.intensityUpdates) {
          for (const u of tick.intensityUpdates) {
            const prev = triggerEventsMapRef.current.get(u.stationIndex);
            if (prev) {
              triggerEventsMapRef.current.set(u.stationIndex, {
                ...prev,
                continuousIntensity: u.continuousIntensity,
                pgvSurface: u.pgvSurface
              });
            }
          }
        }

        if (tick.newTriggers.length > 0 || (tick.intensityUpdates && tick.intensityUpdates.length > 0)) {
          setMapVersion((v) => v + 1);
        }

        if (tick.currentEEWReport) {
          eewReportRef.current = tick.currentEEWReport;
          setEewReport(tick.currentEEWReport);
        }

        updateFps();
        break;
      }

      case 'SEEK_SNAPSHOT': {
        const snapshot = msg.payload;
        const tick = snapshot.tick;
        setSimTime(tick.simTime);
        setPRadiusKm(tick.pWaveRadiusKm);
        setSRadiusKm(tick.sWaveRadiusKm);

        stationStatesRef.current.fill(StationState.IDLE);
        triggerEventsMapRef.current.clear();
        for (const trigger of tick.newTriggers) {
          stationStatesRef.current[trigger.stationIndex] = trigger.state;
          triggerEventsMapRef.current.set(trigger.stationIndex, trigger);
        }
        if (tick.intensityUpdates) {
          for (const update of tick.intensityUpdates) {
            const previous = triggerEventsMapRef.current.get(update.stationIndex);
            if (previous) {
              triggerEventsMapRef.current.set(update.stationIndex, {
                ...previous,
                continuousIntensity: update.continuousIntensity,
                pgvSurface: update.pgvSurface
              });
            }
          }
        }

        eewReportRef.current = snapshot.eewReport;
        setEewReport(snapshot.eewReport);
        setFlashReport(snapshot.flashReport);
        setEarthquakeInfoReport(snapshot.earthquakeInfoReport);
        setLpgmReport(snapshot.lpgmReport);
        setMilestones(snapshot.milestones);
        setMapVersion((version) => version + 1);
        break;
      }

      case 'EEW_ALERT':
        if (shouldPlayEewWarningChime(eewReportRef.current, msg.payload)) {
          audioAlertSystem.playEewWarningChime();
          audioAlertSystem.speak(formatEewWarningAnnouncement(msg.payload));
        }
        eewReportRef.current = msg.payload;
        setEewReport(msg.payload);
        break;

      case 'FLASH_REPORT':
        setFlashReport(msg.payload);
        break;

      case 'EARTHQUAKE_INFO':
        setEarthquakeInfoReport(msg.payload);
        break;

      case 'LPGM_REPORT':
        setLpgmReport(msg.payload);
        break;

      case 'MILESTONE':
        setMilestones((previousMilestones) => [...previousMilestones, msg.payload]);
        break;

      default:
        break;
    }
  }, [updateFps]);

  const retryStartup = useCallback(() => {
    setIsReady(false);
    setStartupError(null);
    setStartupPhase('tiles');
    setStartupProgress({ completed: 0, total: 0 });
    setStartupAttempt((attempt) => attempt + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();
    let startupWorker: Worker | null = null;

    const initialize = async () => {
      setIsReady(false);
      setStartupError(null);
      setStartupPhase('tiles');
      setStartupProgress({ completed: 0, total: 0 });

      try {
        await preloadMeshTiles(
          (progress) => {
            if (!cancelled) setStartupProgress(progress);
          },
          abortController.signal
        );
        if (cancelled) return;

        setStartupPhase('stations');
        const dataSet = await StationLoader.loadStations(
          '/data/stations/stations.bin',
          '/data/stations/stations_meta.json'
        );
        if (cancelled) return;

        // Initial buffer without ampFactors; we'll compute amplification from tiles.
        const buffer: StationDataBuffer = {
          totalStations: dataSet.totalStations,
          lats: dataSet.lats,
          lons: dataSet.lons,
          ampFactors: new Float32Array(dataSet.totalStations), // placeholder
          prefCodes: dataSet.prefCodes
        };
        // Compute ARV amplification factors from mesh tiles.
        const computedAmpFactors = await computeAmpFactorsFromTiles(
          dataSet.lats,
          dataSet.lons,
          undefined,
          undefined,
          undefined,
          dataSet.ampFactors
        );
        if (cancelled) return;
        buffer.ampFactors = computedAmpFactors;
        // Keep population density for ambient display only.
        const dailyNoise = await loadDailyNoise(dataSet.totalStations);
        if (cancelled) return;
        buffer.dailyNoise = dailyNoise;

        setStationBuffer(buffer);
        stationStatesRef.current = new Uint8Array(dataSet.totalStations);

        const worker = new Worker(new URL('../workers/simulation.worker.ts', import.meta.url), {
          type: 'module'
        });

        startupWorker = worker;
        workerRef.current = worker;
        worker.onmessage = handleWorkerMessage;
        worker.onerror = (event) => {
          console.error('[SimulationContext] Simulation worker failed:', event.message);
          setStartupError(`Simulation worker failed: ${event.message}`);
          setIsReady(false);
        };
        setStartupPhase('worker');
        worker.postMessage({ type: 'INIT_STATIONS', payload: buffer });
      } catch (error) {
        if (cancelled) return;
        console.error('[SimulationContext] Startup initialization failed:', error);
        setStartupError(error instanceof Error ? error.message : String(error));
      }
    };

    void initialize();

    return () => {
      cancelled = true;
      abortController.abort();
      if (startupWorker) {
        startupWorker.terminate();
        if (workerRef.current === startupWorker) workerRef.current = null;
      }
    };
  }, [handleWorkerMessage, startupAttempt]);

  const postWorkerAction = (action: WorkerInboundAction) => {
    if (workerRef.current) {
      workerRef.current.postMessage(action);
    }
  };

  const play = useCallback(() => {
    if (!isReady || !workerRef.current) return;
    if (!hasEpicenter) return;

    const config = createSimulationConfig(hypocenter, timeScale);

    if (!isPlaying && simTime === 0.0) {
      postWorkerAction({ type: 'START', payload: config });
    } else {
      postWorkerAction({ type: 'RESUME' });
    }
    setIsPlaying(true);
  }, [isReady, isPlaying, simTime, hypocenter, timeScale, hasEpicenter]);

  const pause = useCallback(() => {
    postWorkerAction({ type: 'PAUSE' });
    setIsPlaying(false);
  }, []);

  const resetSimulation = useCallback((config?: ReturnType<typeof createSimulationConfig>) => {
    if (!hasEpicenter) return;
    postWorkerAction(config ? { type: 'RESET', payload: config } : { type: 'RESET' });
    setIsPlaying(false);
    setSimTime(0.0);
    setPRadiusKm(0.0);
    setSRadiusKm(0.0);
    clearReportState();
    if (stationBuffer) {
      stationStatesRef.current.fill(0);
    }
    triggerEventsMapRef.current.clear();
    setMapVersion((version) => version + 1);
  }, [clearReportState, stationBuffer, hasEpicenter]);

  const reset = useCallback(() => {
    resetSimulation();
  }, [resetSimulation]);

  const seek = useCallback((time: number) => {
    postWorkerAction({ type: 'SEEK', payload: { time } });
    const targetTime = Math.max(0, time);
    setSimTime(targetTime);
    setPRadiusKm(Math.sqrt(Math.max(0, (6 * targetTime) ** 2 - hypocenter.depth ** 2)));
    setSRadiusKm(Math.sqrt(Math.max(0, (3.5 * targetTime) ** 2 - hypocenter.depth ** 2)));
    stationStatesRef.current.fill(StationState.IDLE);
    triggerEventsMapRef.current.clear();
    setMapVersion((version) => version + 1);
    clearReportState();
  }, [clearReportState, hypocenter.depth]);

  const toggleMute = useCallback(() => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    audioAlertSystem.setMute(nextMuted);
  }, [isMuted]);

  const toggleSpeech = useCallback(() => {
    const nextEnabled = !isSpeechEnabled;
    setIsSpeechEnabled(nextEnabled);
    audioAlertSystem.setSpeechEnabled(nextEnabled);
  }, [isSpeechEnabled]);

  const setHypocenter = useCallback((lat: number, lon: number) => {
    const updated = { ...hypocenter, lat, lon };
    setHypocenterState(updated);
    setHasEpicenter(true);
    if (isPlaying || simTime > 0) {
      resetSimulation(createSimulationConfig(updated, timeScale));
    }
  }, [hypocenter, isPlaying, simTime, timeScale, resetSimulation]);

  const setDepth = useCallback((depthKm: number) => {
    const updated = { ...hypocenter, depth: depthKm };
    setHypocenterState(updated);
    if (isPlaying || simTime > 0) {
      resetSimulation(createSimulationConfig(updated, timeScale));
    }
  }, [hypocenter, isPlaying, simTime, timeScale, resetSimulation]);

  const setMagnitude = useCallback((mw: number) => {
    const updated = { ...hypocenter, magnitude: mw };
    setHypocenterState(updated);
    if (isPlaying || simTime > 0) {
      resetSimulation(createSimulationConfig(updated, timeScale));
    }
  }, [hypocenter, isPlaying, simTime, timeScale, resetSimulation]);

  const setTimeScale = useCallback((speed: number) => {
    setTimeScaleState(speed);
    postWorkerAction({ type: 'SET_SPEED', payload: { speed } });
  }, []);

  const toggleKyoshinMonitor = useCallback(() => {
    setIsKyoshinMonitor(prev => !prev);
  }, []);

  const toggleMeshVisible = useCallback(() => {
    setIsMeshVisible(prev => !prev);
  }, []);

  const toggleFaultVisible = useCallback(() => {
    setIsFaultVisible(prev => !prev);
  }, []);

  const toggleArvVisible = useCallback(() => {
    setIsArvVisible(prev => !prev);
  }, []);

  const jumpToTime = useCallback((targetTime: number) => {
    if (!isPlaying) {
      play();
    }
    seek(targetTime);
  }, [isPlaying, play, seek]);

  return (
    <SimulationContext.Provider
      value={{
        isReady,
        startupPhase,
        startupProgress,
        startupError,
        retryStartup,
        isPlaying,
        simTime,
        pRadiusKm,
        sRadiusKm,
        timeScale,
        hypocenter,
        stationBuffer,
        stationStates: stationStatesRef.current,
        triggerEventsMap: triggerEventsMapRef.current,
        eewReport,
        flashReport,
        earthquakeInfoReport,
        lpgmReport,
        milestones,
        isMeshVisible,
        fps,
        isMuted,
        isSpeechEnabled,
        isSpeechSupported,
        isKyoshinMonitor,
        ambientNoiseLevels,
        ambientNoiseUpdatedAt,
        mapVersion,
        hasEpicenter,
        mapDisplayMode,
        isFaultVisible,
        isArvVisible,
        toggleKyoshinMonitor,
        setHypocenter,
        setDepth,
        setMagnitude,
        setTimeScale,
        toggleMeshVisible,
        toggleFaultVisible,
        toggleArvVisible,
        play,
        pause,
        reset,
        seek,
        toggleMute,
        toggleSpeech,
        setMapDisplayMode,
        jumpToTime
      }}
    >
      {children}
    </SimulationContext.Provider>
  );
};

export const useSimulation = () => {
  const ctx = useContext(SimulationContext);
  if (!ctx) {
    throw new Error('useSimulation must be used within a SimulationProvider');
  }
  return ctx;
};
