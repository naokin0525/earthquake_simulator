/**
 * src/workers/simulation.worker.ts
 * =================================
 * Dedicated Web Worker running the high-frequency (20 Hz / 50 ms) simulation tick loop
 * and real-time EEW inversion pipeline without blocking the main UI thread.
 */

import {
  SimulationConfig,
  SimulationMilestone,
  SimulationSeekSnapshot,
  StationDataBuffer,
  StationState,
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
      stationBuffer.prefCodes,
      stationBuffer.lats,
      stationBuffer.lons
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
        eventSequencer = new EventSequencer(slabModel);
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
        if (simulationEngine && eewEngine && eventSequencer && stationBuffer) {
          const tick = simulationEngine.seek(action.payload.time);
          eewEngine.reset();
          eventSequencer.reset();

          const hypo = simulationEngine.getConfig()?.hypocenter;
          const pTriggers = tick.newTriggers.filter((trigger) => trigger.state === StationState.P_TRIGGERED);
          const eewReport = eewEngine.update(
            pTriggers,
            stationBuffer.lats,
            stationBuffer.lons,
            stationBuffer.ampFactors,
            tick.simTime
          );
          tick.currentEEWReport = eewReport;

          const milestones: SimulationMilestone[] = [];
          const reports: Omit<SimulationSeekSnapshot, 'tick' | 'milestones'> = {
            eewReport,
            flashReport: null,
            earthquakeInfoReport: null,
            lpgmReport: null
          };
          const firstTrigger = pTriggers.reduce<typeof pTriggers[number] | null>(
            (first, trigger) => !first || trigger.triggerTime < first.triggerTime ? trigger : first,
            null
          );
          const origin = eventSequencer.update(0, 0, null, hypo, [], stationBuffer.prefCodes, stationBuffer.lats, stationBuffer.lons);
          if (origin.milestone) milestones.push(origin.milestone);
          if (firstTrigger) {
            const first = eventSequencer.update(
              firstTrigger.triggerTime,
              1,
              null,
              hypo,
              [firstTrigger],
              stationBuffer.prefCodes,
              stationBuffer.lats,
              stationBuffer.lons
            );
            if (first.milestone) milestones.push(first.milestone);
          }

          if (tick.simTime > 0) {
            for (let attempt = 0; attempt < 10; attempt++) {
              const result = eventSequencer.update(
                tick.simTime,
                pTriggers.length,
                eewReport,
                hypo,
                tick.newTriggers,
                stationBuffer.prefCodes,
                stationBuffer.lats,
                stationBuffer.lons
              );
              if (result.milestone) milestones.push(result.milestone);
              if (!result.event && !result.milestone) break;

              if (result.event?.type === 'FLASH_REPORT') {
                reports.flashReport = result.event.payload;
              } else if (result.event?.type === 'EARTHQUAKE_INFO') {
                reports.earthquakeInfoReport = result.event.payload;
              } else if (result.event?.type === 'LPGM_REPORT') {
                reports.lpgmReport = result.event.payload;
              }
            }
          }

          postWorkerMessage({
            type: 'SEEK_SNAPSHOT',
            payload: { tick, ...reports, milestones }
          });
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
        if (simulationEngine) {
          if (action.payload) {
            simulationEngine.init(action.payload);
          } else {
            simulationEngine.reset();
          }
        }
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
