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
  IntensityUpdate,
  JmaIntensityScale,
  StationState,
  StationTriggerEvent,
  WorkerInboundAction,
  WorkerOutboundEvent,
  PACKED_INTENSITY_UPDATE_STRIDE
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
const UI_UPDATE_INTERVAL_MS = 100; // Keep React and Deck.gl updates at 10 Hz.
let uiUpdateElapsedMs = 0;
let pendingTriggers: StationTriggerEvent[] = [];
const INTENSITY_SCALE_CODES: Record<JmaIntensityScale, number> = {
  '0': 0,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5-': 5,
  '5+': 6,
  '6-': 7,
  '6+': 8,
  '7': 9
};

function postWorkerMessage(event: WorkerOutboundEvent, transferables: Transferable[] = []): void {
  self.postMessage(event, transferables);
}

function packIntensityUpdates(updates: readonly IntensityUpdate[]): Float32Array {
  const packed = new Float32Array(updates.length * PACKED_INTENSITY_UPDATE_STRIDE);
  for (let index = 0; index < updates.length; index++) {
    const update = updates[index];
    const offset = index * PACKED_INTENSITY_UPDATE_STRIDE;
    packed[offset] = update.stationIndex;
    packed[offset + 1] = update.observedContinuousIntensity ?? update.continuousIntensity;
    packed[offset + 2] = INTENSITY_SCALE_CODES[update.observedIntensity ?? '0'];
    packed[offset + 3] = update.observedPgv ?? update.pgvSurface;
    packed[offset + 4] = update.maximumObservedContinuousIntensity ?? Number.NaN;
    packed[offset + 5] = INTENSITY_SCALE_CODES[update.maximumObservedIntensity ?? '0'];
    packed[offset + 6] = update.maximumObservedPgv ?? Number.NaN;
    packed[offset + 7] = update.observedAmplitudeFraction ?? Number.NaN;
  }
  return packed;
}

function startTickLoop(): void {
  stopTickLoop();
  lastTickTimestamp = performance.now();
  uiUpdateElapsedMs = 0;

  tickTimer = setInterval(() => {
    if (!simulationEngine || !stationBuffer || !eewEngine || !eventSequencer) return;

    // Each tick advances the simulation by a small real-time delta. The elapsed wall-clock
    // time is converted to simulated seconds, which lets the engine run faster/slower than real time
    // according to the configured timeScale factor.
    const now = performance.now();
    const elapsedMs = now - lastTickTimestamp;
    const dtSeconds = elapsedMs / 1000.0;
    lastTickTimestamp = now;
    uiUpdateElapsedMs += elapsedMs;

    // 1) Advance the physical simulation state and collect any newly triggered stations.
    const tickState = simulationEngine.update(dtSeconds);

    // 2) Evaluate EEW alerts when new triggers occurred or periodically (every ~1.0s) so sequential reports update reliably.
    const eewReport = eewEngine.update(
      tickState.newTriggers,
      stationBuffer.lats,
      stationBuffer.lons,
      stationBuffer.ampFactors,
      tickState.simTime,
      tickState.intensityUpdates
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
      simulationEngine.getActiveStationCount(),
      tickState.currentEEWReport,
      simulationEngine.getConfig()?.hypocenter,
      tickState.newTriggers,
      stationBuffer.prefCodes,
      stationBuffer.lats,
      stationBuffer.lons,
      tickState.intensityUpdates
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

    // Keep simulation and reporting at 20 Hz, but limit expensive UI snapshots to 10 Hz.
    pendingTriggers.push(...tickState.newTriggers);
    if (uiUpdateElapsedMs >= UI_UPDATE_INTERVAL_MS) {
      uiUpdateElapsedMs %= UI_UPDATE_INTERVAL_MS;
      tickState.newTriggers = pendingTriggers;
      pendingTriggers = [];
      const { intensityUpdates = [], ...tick } = tickState;
      const packedIntensityUpdates = packIntensityUpdates(intensityUpdates);
      postWorkerMessage(
        { type: 'TICK', payload: { tick, intensityUpdates: packedIntensityUpdates } },
        packedIntensityUpdates.length > 0 ? [packedIntensityUpdates.buffer] : []
      );
    }
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
        pendingTriggers = [];
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
          pendingTriggers = [];
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
            tick.simTime,
            tick.intensityUpdates
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
              stationBuffer.lons,
              tick.intensityUpdates
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
        pendingTriggers = [];
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
