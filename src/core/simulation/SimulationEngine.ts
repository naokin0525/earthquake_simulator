/**
 * src/core/simulation/SimulationEngine.ts
 * ========================================
 * High-performance stateful simulation engine for ground truth wave propagation
 * and station trigger state updates.
 */

import {
  EarthquakeHypocenter,
  SimulationConfig,
  SimulationTickState,
  StationDataBuffer,
  StationState,
  StationTriggerEvent
} from '../types';
import { computeTravelTimes } from '../physics/travelTime';
import { calculateJmaIntensity } from '../physics/attenuation';
import { calculateSlabFraction } from '../physics/slabModel';

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
  private stationStates: Uint8Array = new Uint8Array(0);
  private measuredPgvs: Float32Array = new Float32Array(0);

  constructor(stations: StationDataBuffer) {
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
    this.stationStates = new Uint8Array(N); // 0 = IDLE
    this.measuredPgvs = new Float32Array(N);

    const hypo = config.hypocenter;
    const noiseStdDev = config.noiseStdDev ?? 0.15;

    for (let i = 0; i < N; i++) {
      const stLat = this.stations.lats[i];
      const stLon = this.stations.lons[i];

      const rSlab = calculateSlabFraction(hypo.lat, hypo.lon, hypo.depth, stLat, stLon);
      this.slabFractions[i] = rSlab;

      const epiDist = Math.sqrt(
        Math.pow((stLat - hypo.lat) * 111.0, 2) +
        Math.pow((stLon - hypo.lon) * 111.0 * Math.cos(stLat * Math.PI / 180.0), 2)
      );
      const R = Math.sqrt(epiDist * epiDist + hypo.depth * hypo.depth);
      this.hypocentralDists[i] = R;
      this.pArrivalTimes[i] = R / 6.0; // P-wave 6.0 km/s
      this.sArrivalTimes[i] = R / 3.5; // S-wave 3.5 km/s

      // Add picking noise to observed P trigger time
      const noise = generateGaussianNoise(noiseStdDev);
      this.pObservedTimes[i] = Math.max(0.0, this.pArrivalTimes[i] + noise);
    }
  }

  public reset(): void {
    this.simTime = 0.0;
    this.isRunning = false;
    this.stationStates.fill(0);
  }

  public setTimeScale(scale: number): void {
    if (this.config) {
      this.config.timeScale = Math.max(0.1, scale);
    }
  }

  public seek(timeSeconds: number): void {
    this.simTime = Math.max(0.0, timeSeconds);
    // Reset station states to prevent "instant trigger" jump
    // Stations should only be triggered if simTime >= pObservedTimes[i]
    this.stationStates.fill(0);

    // Re-evaluate all stations for the new seek time
    const N = this.stations.totalStations;
    for (let i = 0; i < N; i++) {
      const pObs = this.pObservedTimes[i];
      const sArr = this.sArrivalTimes[i];

      if (this.simTime >= sArr) {
        this.stationStates[i] = StationState.S_ARRIVED;
      } else if (this.simTime >= pObs) {
        this.stationStates[i] = StationState.P_TRIGGERED;
      }
    }
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

    // Wave radii
    // Note: Visual radii are calculated as distance = velocity * time
    // P-wave approx 6.0 km/s, S-wave approx 3.5 km/s
    const pWaveRadiusKm = 6.0 * elapsedTime;
    const sWaveRadiusKm = 3.5 * elapsedTime;

    const N = this.stations.totalStations;
    const newTriggers: StationTriggerEvent[] = [];

    for (let i = 0; i < N; i++) {
      const currentState = this.stationStates[i];
      const pObs = this.pObservedTimes[i];
      const sArr = this.sArrivalTimes[i];

      if (currentState === StationState.IDLE && this.simTime >= pObs) {
        // Switch to P_TRIGGERED
        this.stationStates[i] = StationState.P_TRIGGERED;

        const R = this.hypocentralDists[i];
        const arv = this.stations.ampFactors[i];
        const rSlab = this.slabFractions[i];

        const { pgvSurface, continuousIntensity, jmaScale } = calculateJmaIntensity(
          R,
          hypo.depth,
          hypo.magnitude,
          arv,
          rSlab
        );

        this.measuredPgvs[i] = pgvSurface;

        newTriggers.push({
          stationIndex: i,
          state: StationState.P_TRIGGERED,
          triggerTime: pObs,
          pArrivalTime: this.pArrivalTimes[i],
          sArrivalTime: sArr,
          pgvSurface,
          intensity: jmaScale,
          continuousIntensity
        });
      } else if (currentState === StationState.P_TRIGGERED && this.simTime >= sArr) {
        // Switch to S_ARRIVED
        this.stationStates[i] = StationState.S_ARRIVED;

        const R = this.hypocentralDists[i];
        const arv = this.stations.ampFactors[i];
        const rSlab = this.slabFractions[i];

        const { pgvSurface, continuousIntensity, jmaScale } = calculateJmaIntensity(
          R,
          hypo.depth,
          hypo.magnitude,
          arv,
          rSlab
        );

        newTriggers.push({
          stationIndex: i,
          state: StationState.S_ARRIVED,
          triggerTime: sArr,
          pArrivalTime: this.pArrivalTimes[i],
          sArrivalTime: sArr,
          pgvSurface,
          intensity: jmaScale,
          continuousIntensity
        });
      }
    }

    return {
      simTime: this.simTime,
      pWaveRadiusKm,
      sWaveRadiusKm,
      newTriggers,
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
