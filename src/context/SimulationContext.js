import { jsx as _jsx } from "react/jsx-runtime";
/**
 * src/context/SimulationContext.tsx
 * =================================
 * React Context bridging UI state with the high-performance simulation Web Worker.
 */
import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { StationLoader } from '../loaders/StationLoader';
import { audioAlertSystem } from '../utils/audioAlert';
const DEFAULT_HYPOCENTER = {
    lat: 35.5,
    lon: 139.5,
    depth: 20.0,
    magnitude: 6.8,
    originTime: 0.0
};
const SimulationContext = createContext(null);
export const SimulationProvider = ({ children }) => {
    const workerRef = useRef(null);
    const [isReady, setIsReady] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [simTime, setSimTime] = useState(0.0);
    const [pRadiusKm, setPRadiusKm] = useState(0.0);
    const [sRadiusKm, setSRadiusKm] = useState(0.0);
    const [timeScale, setTimeScaleState] = useState(1.0);
    const [hypocenter, setHypocenterState] = useState(DEFAULT_HYPOCENTER);
    const [stationBuffer, setStationBuffer] = useState(null);
    const [eewReport, setEewReport] = useState(null);
    const [flashReport, setFlashReport] = useState(null);
    const [lpgmReport, setLpgmReport] = useState(null);
    const [milestones, setMilestones] = useState([]);
    const [isMeshVisible, setIsMeshVisible] = useState(false);
    const [fps, setFps] = useState(60);
    const [isMuted, setIsMuted] = useState(audioAlertSystem.getMuted());
    const stationStatesRef = useRef(new Uint8Array(0));
    const triggerEventsMapRef = useRef(new Map());
    // FPS Counter
    const frameCountRef = useRef(0);
    const lastFpsTimeRef = useRef(performance.now());
    useEffect(() => {
        // 1. Load station binary data
        StationLoader.loadStations('/data/stations/stations.bin', '/data/stations/stations_meta.json')
            .then((dataSet) => {
            const buffer = {
                totalStations: dataSet.totalStations,
                lats: dataSet.lats,
                lons: dataSet.lons,
                ampFactors: dataSet.ampFactors,
                prefCodes: dataSet.prefCodes
            };
            setStationBuffer(buffer);
            stationStatesRef.current = new Uint8Array(dataSet.totalStations);
            // 2. Instantiate Web Worker
            const worker = new Worker(new URL('../workers/simulation.worker.ts', import.meta.url), {
                type: 'module'
            });
            workerRef.current = worker;
            worker.onmessage = (event) => {
                const msg = event.data;
                switch (msg.type) {
                    case 'READY':
                        setIsReady(true);
                        break;
                    case 'TICK': {
                        const tick = msg.payload;
                        setSimTime(tick.simTime);
                        setPRadiusKm(tick.pWaveRadiusKm);
                        setSRadiusKm(tick.sWaveRadiusKm);
                        // Update station trigger states
                        for (const ev of tick.newTriggers) {
                            stationStatesRef.current[ev.stationIndex] = ev.state;
                            triggerEventsMapRef.current.set(ev.stationIndex, ev);
                        }
                        if (tick.currentEEWReport) {
                            setEewReport(tick.currentEEWReport);
                        }
                        // Update FPS counter
                        frameCountRef.current++;
                        const now = performance.now();
                        if (now - lastFpsTimeRef.current >= 1000) {
                            setFps(Math.round((frameCountRef.current * 1000) / (now - lastFpsTimeRef.current)));
                            frameCountRef.current = 0;
                            lastFpsTimeRef.current = now;
                        }
                        break;
                    }
                    case 'EEW_ALERT':
                        setEewReport(msg.payload);
                        // Play warning chime if this is the first warning
                        if (msg.payload.isWarning && !eewReport?.isWarning) {
                            audioAlertSystem.playEewWarningChime();
                        }
                        break;
                    case 'FLASH_REPORT':
                        setFlashReport(msg.payload);
                        break;
                    case 'LPGM_REPORT':
                        setLpgmReport(msg.payload);
                        break;
                    case 'MILESTONE':
                        setMilestones(prev => [...prev, msg.payload]);
                        break;
                    default:
                        break;
                }
            };
            // Send INIT_STATIONS to Worker
            worker.postMessage({ type: 'INIT_STATIONS', payload: buffer });
        })
            .catch((err) => {
            console.warn('[SimulationContext] Station binary load fallback or missing:', err);
        });
        return () => {
            if (workerRef.current) {
                workerRef.current.terminate();
            }
        };
    }, []);
    const postWorkerAction = (action) => {
        if (workerRef.current) {
            workerRef.current.postMessage(action);
        }
    };
    const play = useCallback(() => {
        if (!isReady || !workerRef.current)
            return;
        const config = {
            hypocenter,
            timeScale,
            tickIntervalMs: 50,
            noiseStdDev: 0.15
        };
        if (!isPlaying && simTime === 0.0) {
            postWorkerAction({ type: 'START', payload: config });
        }
        else {
            postWorkerAction({ type: 'RESUME' });
        }
        setIsPlaying(true);
    }, [isReady, isPlaying, simTime, hypocenter, timeScale]);
    const pause = useCallback(() => {
        postWorkerAction({ type: 'PAUSE' });
        setIsPlaying(false);
    }, []);
    const reset = useCallback(() => {
        postWorkerAction({ type: 'RESET' });
        setIsPlaying(false);
        setSimTime(0.0);
        setPRadiusKm(0.0);
        setSRadiusKm(0.0);
        setEewReport(null);
        setFlashReport(null);
        setLpgmReport(null);
        setMilestones([]);
        if (stationBuffer) {
            stationStatesRef.current.fill(0);
        }
        triggerEventsMapRef.current.clear();
    }, [stationBuffer]);
    const seek = useCallback((time) => {
        postWorkerAction({ type: 'SEEK', payload: { time } });
        // Reset reports and milestones because we are jumping in time
        // The worker will re-emit milestones/reports as it ticks forward
        setEewReport(null);
        setFlashReport(null);
        setLpgmReport(null);
        setMilestones([]);
    }, []);
    const toggleMute = useCallback(() => {
        const nextMuted = !isMuted;
        setIsMuted(nextMuted);
        audioAlertSystem.setMute(nextMuted);
    }, [isMuted]);
    const setHypocenter = useCallback((lat, lon) => {
        const updated = { ...hypocenter, lat, lon };
        setHypocenterState(updated);
        if (isPlaying) {
            reset();
        }
    }, [hypocenter, isPlaying, reset]);
    const setDepth = useCallback((depthKm) => {
        const updated = { ...hypocenter, depth: depthKm };
        setHypocenterState(updated);
    }, [hypocenter]);
    const setMagnitude = useCallback((mw) => {
        const updated = { ...hypocenter, magnitude: mw };
        setHypocenterState(updated);
    }, [hypocenter]);
    const setTimeScale = useCallback((speed) => {
        setTimeScaleState(speed);
        postWorkerAction({ type: 'SET_SPEED', payload: { speed } });
    }, []);
    const toggleMeshVisible = useCallback(() => {
        setIsMeshVisible((prev) => !prev);
    }, []);
    return (_jsx(SimulationContext.Provider, { value: {
            isReady,
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
            lpgmReport,
            milestones,
            isMeshVisible,
            fps,
            isMuted,
            setHypocenter,
            setDepth,
            setMagnitude,
            setTimeScale,
            toggleMeshVisible,
            play,
            pause,
            reset,
            seek,
            toggleMute
        }, children: children }));
};
export const useSimulation = () => {
    const ctx = useContext(SimulationContext);
    if (!ctx) {
        throw new Error('useSimulation must be used within a SimulationProvider');
    }
    return ctx;
};
