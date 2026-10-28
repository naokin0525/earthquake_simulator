/**
 * src/core/simulation/SimulationEngine.ts
 * =======================================
 * High-performance stateful simulation engine for ground truth wave propagation
 * and station trigger state updates.
 */

import {
  EarthquakeHypocenter,
  IntensityUpdate,
  SimulationConfig,
  SimulationTickState,
  StationDataBuffer,
  StationState,
  StationTriggerEvent
} from '../types';
import { computeTravelTimes } from '../physics/travelTime';
import { calculateJmaIntensity, calculateContinuousJmaIntensity, envelope } from '../physics/attenuation';
import { calculateSlabFraction, Slab2Model } from '../physics/slabModel';
import { pointSourceDistance } from '../physics/distance';

function generateGaussianNoise(stdDev: number): number {
  const u1 = Math.max(1e-10, Math.random());
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * stdDev;
}

export class SimulationEngine {
  private stations: StationDataBuffer;
  private config: SimulationConfig | null = null;
  private simTime: number = 0.0;
  private isRunning: boolean = false;

  // Precalculated per-station parameters
  private pArrivalTimes: Float32Array = new Float32Array(0);
  private sArrivalTimes: Float32Array = new Float32Array(0);
  private pObservedTimes: Float32Array = new Float32Array(0);
  private hypocentralDists: Float32Array = new Float32Array(0);
  private slabFractions: Float32Array = new Float32Array(0);
  private unobservableStations: Uint8Array = new Uint8Array(0);
  private stationStates: Uint8Array = new Uint8Array(0);
  private measuredPgvs: Float32Array = new Float32Array(0);

  constructor(stations: StationDataBuffer, private readonly slabModel?: Slab2Model) {
    this.stations = stations;
    const N = this.stations.totalStations;
    this.stationStates = new Uint8Array(N);
    this.reset();
  }

  /**
   * Initializes or re-initializes the simulation with a new configuration.
   */
  public init(config: SimulationConfig): void {
    this.config = config;
    this.simTime = 0.0;
    this.isRunning = false;

    const N = this.stations.totalStations;
    this.pArrivalTimes = new Float32Array(N);
    this.sArrivalTimes = new Float32Array(N);
    this.pObservedTimes = new Float32Array(N);
    this.hypocentralDists = new Float32Array(N);
    this.slabFractions = new Float32Array(N);
    this.unobservableStations = new Uint8Array(N);
    this.stationStates = new Uint8Array(N); // 0 = IDLE
    this.measuredPgvs = new Float32Array(N);

    const hypo = config.hypocenter;
    const noiseStdDev = config.noiseStdDev ?? 0.15;

    for (let i = 0; i < N; i++) {
      const stLat = this.stations.lats[i];
      const stLon = this.stations.lons[i];

      // Slab fraction adjusts modeled wave velocity along subduction-zone paths.
      const rSlab = calculateSlabFraction(hypo.lat, hypo.lon, hypo.depth, stLat, stLon, this.slabModel);
      this.slabFractions[i] = rSlab;

      const travelTimes = computeTravelTimes(hypo, stLat, stLon, rSlab);
      this.hypocentralDists[i] = travelTimes.hypocentralDistance;
      this.pArrivalTimes[i] = travelTimes.pArrivalTime;
      this.sArrivalTimes[i] = travelTimes.sArrivalTime;
      this.unobservableStations[i] = calculateJmaIntensity(
        travelTimes.hypocentralDistance,
        hypo.depth,
        hypo.magnitude,
        this.stations.ampFactors[i],
        rSlab,
        undefined,
        stLat,
        stLon,
        hypo.lat,
        hypo.lon,
        this.slabModel
      ).jmaScale === '0' ? 1 : 0;

      // Add a small Gaussian pick error to mimic real station arrival-time picking variability.
      const noise = generateGaussianNoise(noiseStdDev);
      this.pObservedTimes[i] = Math.max(0.0, this.pArrivalTimes[i] + noise);
    }
  }

  public reset(): void {
    this.simTime = 0.0;
    this.isRunning = false;
    this.stationStates.fill(0);
    this.measuredPgvs.fill(0);
  }

  public setTimeScale(scale: number): void {
    if (this.config) {
      this.config.timeScale = Math.max(0.1, scale);
    }
  }

  public seek(timeSeconds: number): SimulationTickState {
    this.simTime = 0.0;
    this.stationStates.fill(StationState.IDLE);
    this.measuredPgvs.fill(0);

    const targetTime = Math.max(0.0, timeSeconds);
    const timeScale = this.config?.timeScale ?? 1.0;
    const pWaveState = this.update(targetTime / timeScale);
    const sWaveState = this.update(0);

    return {
      ...sWaveState,
      newTriggers: [...pWaveState.newTriggers, ...sWaveState.newTriggers]
    };
  }

  /**
   * Advances the simulation state by dtSeconds.
   * Returns incremental state deltas for newly triggered stations.
   */
  public update(dtSeconds: number): SimulationTickState {
    if (!this.config) {
      return {
        simTime: 0.0,
        pWaveRadiusKm: 0.0,
        sWaveRadiusKm: 0.0,
        newTriggers: [],
        currentEEWReport: null
      };
    }

    const timeScale = this.config.timeScale ?? 1.0;
    this.simTime += dtSeconds * timeScale;

    const hypo = this.config.hypocenter;
    const elapsedTime = Math.max(0.0, this.simTime);

    // The visual wave-front radii are projected onto the surface, accounting for hypocenter depth.
    // This avoids the unrealistic situation where the surface radius exceeds the distance that the wave could have traveled.
    const pWaveRadiusKm = Math.max(0, Math.sqrt(Math.max(0, Math.pow(6.0 * elapsedTime, 2) - Math.pow(hypo.depth, 2))));
    const sWaveRadiusKm = Math.max(0, Math.sqrt(Math.max(0, Math.pow(3.5 * elapsedTime, 2) - Math.pow(hypo.depth, 2))));

    const N = this.stations.totalStations;
    const newTriggers: StationTriggerEvent[] = [];
    const intensityUpdates: IntensityUpdate[] = [];

    for (let i = 0; i < N; i++) {
      if (this.unobservableStations[i]) continue;

      const currentState = this.stationStates[i];
      const pObs = this.pObservedTimes[i];
      const sArr = this.sArrivalTimes[i];

      if (currentState === StationState.IDLE && this.simTime >= pObs) {
        // P-wave trigger: a station transitions from silent to activated once the modeled arrival time is reached.
        this.stationStates[i] = StationState.P_TRIGGERED;

        const stLat = this.stations.lats[i];
        const stLon = this.stations.lons[i];
        const arv = this.stations.ampFactors[i];
        const rSlab = this.slabFractions[i];
        const faultDist = pointSourceDistance(stLat, stLon, hypo.lat, hypo.lon, hypo.depth);
        const { pgvSurface, continuousIntensity, jmaScale } = calculateJmaIntensity(
          faultDist,
          hypo.depth,
          hypo.magnitude,
          arv,
          rSlab,
          undefined,
          stLat,
          stLon,
          hypo.lat,
          hypo.lon,
          this.slabModel
        );

        this.measuredPgvs[i] = pgvSurface;

        // Placeholder conversion: in a demo model, acceleration is estimated by scaling PGV by 10,
        // which is sufficient for UI-level forecast behavior without implementing a full acceleration model.
        const accelerationGal = pgvSurface * 10;

        newTriggers.push({
          stationIndex: i,
          state: StationState.P_TRIGGERED,
          triggerTime: pObs,
          pArrivalTime: this.pArrivalTimes[i],
          sArrivalTime: sArr,
          pgvSurface,
          intensity: jmaScale,
          continuousIntensity,
          predictedIntensity: jmaScale,
          predictedContinuousIntensity: continuousIntensity,
          accelerationGal
        });
      } else if (currentState === StationState.P_TRIGGERED && this.simTime >= sArr) {
        // S-wave trigger: once the S-wave arrives, the station enters a stronger state that often
        // correlates with stronger shaking and more severe EEW intensity estimates.
        this.stationStates[i] = StationState.S_ARRIVED;

        const arv = this.stations.ampFactors[i];
        const rSlab = this.slabFractions[i];
        // Compute distance to fault plane for S‑wave trigger (same as P‑wave)
        const stLat = this.stations.lats[i];
        const stLon = this.stations.lons[i];
        const faultDist = pointSourceDistance(stLat, stLon, hypo.lat, hypo.lon, hypo.depth);

        const { pgvSurface, continuousIntensity, jmaScale } = calculateJmaIntensity(
          faultDist,
          hypo.depth,
          hypo.magnitude,
          arv,
          rSlab,
          undefined,
          stLat,
          stLon,
          hypo.lat,
          hypo.lon,
          this.slabModel
        );

        this.measuredPgvs[i] = pgvSurface;

        // Reuse same placeholder conversion for acceleration (not used for S_ARRIVED events)
        const accelerationGal = pgvSurface * 10;

        newTriggers.push({
          stationIndex: i,
          state: StationState.S_ARRIVED,
          triggerTime: sArr,
          pArrivalTime: this.pArrivalTimes[i],
          sArrivalTime: sArr,
          pgvSurface,
          intensity: jmaScale,
          continuousIntensity,
          predictedIntensity: jmaScale,
          predictedContinuousIntensity: continuousIntensity,
          accelerationGal
        });
      }

      if (this.stationStates[i] >= StationState.P_TRIGGERED) {
        const peakPgv = this.measuredPgvs[i];
        const instPgv = envelope(this.simTime, pObs, sArr, hypo.magnitude, peakPgv);
        const continuousIntensity = calculateContinuousJmaIntensity(instPgv);
        intensityUpdates.push({
          stationIndex: i,
          continuousIntensity,
          predictedContinuousIntensity: continuousIntensity,
          pgvSurface: instPgv
        });
      }
    }

    return {
      simTime: this.simTime,
      pWaveRadiusKm,
      sWaveRadiusKm,
      newTriggers,
      intensityUpdates,
      currentEEWReport: null
    };
  }

  public getSimTime(): number {
    return this.simTime;
  }

  public getConfig(): SimulationConfig | null {
    return this.config;
  }

  public getStationStates(): Uint8Array {
    return this.stationStates;
  }
}
