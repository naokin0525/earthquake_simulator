/**
 * src/workers/simulation.worker.ts
 * =================================
 * Dedicated Web Worker running the high-frequency (20 Hz / 50 ms) simulation tick loop
 * and real-time EEW inversion pipeline without blocking the main UI thread.
 */
import { SimulationEngine } from '../core/simulation/SimulationEngine';
import { EEWEngine } from '../core/eew/EEWEngine';
import { EventSequencer } from '../core/simulation/EventSequencer';
let simulationEngine = null;
let eewEngine = null;
let eventSequencer = null;
let stationBuffer = null;
let tickTimer = null;
let lastTickTimestamp = 0;
const TICK_INTERVAL_MS = 50; // 20 Hz tick rate (50 ms per tick)
function postWorkerMessage(event) {
    self.postMessage(event);
}
function startTickLoop() {
    stopTickLoop();
    lastTickTimestamp = performance.now();
    tickTimer = setInterval(() => {
        if (!simulationEngine || !stationBuffer || !eewEngine || !eventSequencer)
            return;
        const now = performance.now();
        const dtSeconds = (now - lastTickTimestamp) / 1000.0;
        lastTickTimestamp = now;
        // Run simulation tick update
        const tickState = simulationEngine.update(dtSeconds);
        // Evaluate EEW report updates for newly triggered stations
        if (tickState.newTriggers.length > 0) {
            const eewReport = eewEngine.update(tickState.newTriggers, stationBuffer.lats, stationBuffer.lons, stationBuffer.ampFactors, tickState.simTime);
            if (eewReport) {
                tickState.currentEEWReport = eewReport;
                postWorkerMessage({ type: 'EEW_ALERT', payload: eewReport });
            }
        }
        // Sequence JMA Events and Milestones
        const seqResult = eventSequencer.update(tickState.simTime, simulationEngine.getStationStates().filter((s) => s !== 0).length, tickState.currentEEWReport, simulationEngine?.getConfig()?.hypocenter);
        if (seqResult.milestone) {
            postWorkerMessage({ type: 'MILESTONE', payload: seqResult.milestone });
        }
        if (seqResult.event) {
            // Map internal sequencer events to worker outbound events
            if (seqResult.event.type === 'FLASH_REPORT') {
                postWorkerMessage({ type: 'FLASH_REPORT', payload: seqResult.event.payload });
            }
            else if (seqResult.event.type === 'LPGM_REPORT') {
                postWorkerMessage({ type: 'LPGM_REPORT', payload: seqResult.event.payload });
            }
        }
        // Emit high-frequency TICK state delta to UI thread
        postWorkerMessage({ type: 'TICK', payload: tickState });
    }, TICK_INTERVAL_MS);
}
function stopTickLoop() {
    if (tickTimer !== null) {
        clearInterval(tickTimer);
        tickTimer = null;
    }
}
self.onmessage = (event) => {
    const action = event.data;
    try {
        switch (action.type) {
            case 'INIT_STATIONS': {
                stationBuffer = action.payload;
                simulationEngine = new SimulationEngine(stationBuffer);
                eewEngine = new EEWEngine();
                eventSequencer = new EventSequencer();
                postWorkerMessage({ type: 'READY' });
                break;
            }
            case 'START': {
                if (!simulationEngine || !eewEngine) {
                    throw new Error('Worker not initialized. Call INIT_STATIONS first.');
                }
                const config = action.payload;
                simulationEngine.init(config);
                eewEngine.reset();
                startTickLoop();
                break;
            }
            case 'PAUSE': {
                stopTickLoop();
                break;
            }
            case 'RESUME': {
                if (simulationEngine) {
                    startTickLoop();
                }
                break;
            }
            case 'SEEK': {
                if (simulationEngine) {
                    simulationEngine.seek(action.payload.time);
                }
                break;
            }
            case 'SET_SPEED': {
                if (simulationEngine) {
                    simulationEngine.setTimeScale(action.payload.speed);
                }
                break;
            }
            case 'RESET': {
                stopTickLoop();
                if (simulationEngine)
                    simulationEngine.reset();
                if (eewEngine)
                    eewEngine.reset();
                if (eventSequencer)
                    eventSequencer.reset();
                break;
            }
            default:
                break;
        }
    }
    catch (err) {
        postWorkerMessage({
            type: 'ERROR',
            payload: { message: err?.message || 'Unknown Web Worker error' }
        });
    }
};
