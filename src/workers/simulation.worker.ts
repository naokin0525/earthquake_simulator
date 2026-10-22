/**
 * src/workers/simulation.worker.ts
 * =================================
 * Dedicated Web Worker running the high-frequency (20 Hz / 50 ms) simulation tick loop
 * and real-time EEW inversion pipeline without blocking the main UI thread.
 */

import {
  SimulationConfig,
  StationDataBuffer,
  WorkerInboundAction,
  WorkerOutboundEvent
} from '../core/types';
import { SimulationEngine } from '../core/simulation/SimulationEngine';
import { EEWEngine } from '../core/eew/EEWEngine';
import { EventSequencer } from '../core/simulation/EventSequencer';
import { Slab2Model } from '../core/physics/slabModel';

let simulationEngine: SimulationEngine | null = null;
let eewEngine: EEWEngine | null = null;
let eventSequencer: EventSequencer | null = null;
let stationBuffer: StationDataBuffer | null = null;

let tickTimer: ReturnType<typeof setInterval> | null = null;
let lastTickTimestamp: number = 0;
const TICK_INTERVAL_MS = 50; // 20 Hz tick rate (50 ms per tick)

function postWorkerMessage(event: WorkerOutboundEvent): void {
  self.postMessage(event);
}

function startTickLoop(): void {
  stopTickLoop();
  lastTickTimestamp = performance.now();

  tickTimer = setInterval(() => {
    if (!simulationEngine || !stationBuffer || !eewEngine || !eventSequencer) return;

    // Each tick advances the simulation by a small real-time delta. The elapsed wall-clock
    // time is converted to simulated seconds, which lets the engine run faster/slower than real time
    // according to the configured timeScale factor.
    const now = performance.now();
    const dtSeconds = (now - lastTickTimestamp) / 1000.0;
    lastTickTimestamp = now;

    // 1) Advance the physical simulation state and collect any newly triggered stations.
    const tickState = simulationEngine.update(dtSeconds);

    // 2) Evaluate EEW alerts when new triggers occurred or periodically (every ~1.0s) so sequential reports update reliably.
    const eewReport = eewEngine.update(
      tickState.newTriggers,
      stationBuffer.lats,
      stationBuffer.lons,
      stationBuffer.ampFactors,
      tickState.simTime
    );

    if (eewReport) {
      tickState.currentEEWReport = eewReport;
      postWorkerMessage({ type: 'EEW_ALERT', payload: eewReport });
    } else if (eewEngine.getLatestReport()) {
      tickState.currentEEWReport = eewEngine.getLatestReport();
    }

    // 3) Convert the current risk state into milestone/event announcements (e.g. warning issuance,
    //    flash report, earthquake info, LPGM report) so the UI can show timed narrative feedback.
    const seqResult = eventSequencer.update(
      tickState.simTime,
      simulationEngine.getStationStates().filter((s: number) => s !== 0).length,
      tickState.currentEEWReport,
      simulationEngine.getConfig()?.hypocenter,
      tickState.newTriggers,
      stationBuffer.prefCodes
    );

    if (seqResult.milestone) {
      postWorkerMessage({ type: 'MILESTONE', payload: seqResult.milestone });
    }
    if (seqResult.event) {
      // Map internal sequencer events to worker outbound events
      if (seqResult.event.type === 'FLASH_REPORT') {
        postWorkerMessage({ type: 'FLASH_REPORT', payload: seqResult.event.payload });
      } else if (seqResult.event.type === 'EARTHQUAKE_INFO') {
        postWorkerMessage({ type: 'EARTHQUAKE_INFO', payload: seqResult.event.payload });
      } else if (seqResult.event.type === 'LPGM_REPORT') {
        postWorkerMessage({ type: 'LPGM_REPORT', payload: seqResult.event.payload });
      }
    }

    // 4) Push the current simulation snapshot to the main thread at the worker's fixed cadence.
    postWorkerMessage({ type: 'TICK', payload: tickState });
  }, TICK_INTERVAL_MS);
}

function stopTickLoop(): void {
  if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

self.onmessage = async (event: MessageEvent<WorkerInboundAction>) => {
  const action = event.data;

  try {
    switch (action.type) {
      case 'INIT_STATIONS': {
        stationBuffer = action.payload;
        const slabModel = await Slab2Model.load();
        simulationEngine = new SimulationEngine(stationBuffer, slabModel);
        eewEngine = new EEWEngine(slabModel);
        eventSequencer = new EventSequencer();
        postWorkerMessage({ type: 'READY' });
        break;
      }

      case 'START': {
        if (!simulationEngine || !eewEngine) {
          throw new Error('Worker not initialized. Call INIT_STATIONS first.');
        }
        const config: SimulationConfig = action.payload;
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
        if (simulationEngine) simulationEngine.reset();
        if (eewEngine) eewEngine.reset();
        if (eventSequencer) eventSequencer.reset();
        break;
      }

      default:
        break;
    }
  } catch (err: unknown) {
    postWorkerMessage({
      type: 'ERROR',
      payload: { message: err instanceof Error ? err.message : 'Unknown Web Worker error' }
    });
  }
};
