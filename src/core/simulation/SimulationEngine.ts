/**
 * src/core/simulation/SimulationEngine.ts
 * =======================================
 * High-performance stateful simulation engine for ground truth wave propagation
 * and station trigger state updates.
 */

import {
  EarthquakeHypocenter,
  IntensityUpdate,
  JmaIntensityScale,
  SimulationConfig,
  SimulationTickState,
  StationDataBuffer,
  StationState,
  StationTriggerEvent
} from '../types';
import { computeTravelTimes, computeWavefrontRadiusKm } from '../physics/travelTime';
import {
  calculateJmaIntensity,
  calculateContinuousJmaIntensity,
  envelope,
  waveformAmplitudeFraction
} from '../physics/attenuation';
import { quantizeJmaIntensity } from '../physics/intensity';
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
  private stationStates: Uint8Array = new Uint8Array(0);
  private predictedPeakPgvs: Float32Array = new Float32Array(0);
  private predictedContinuousIntensities: Float32Array = new Float32Array(0);
  private predictedIntensities: Array<JmaIntensityScale | undefined> = [];
  private maximumObservedPgvs: Float32Array = new Float32Array(0);
  private pArrivalOrder: Uint32Array = new Uint32Array(0);
  private nextPArrivalIndex = 0;
  private activeStationIndices: number[] = [];
  private activeStationCount = 0;

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
    this.stationStates = new Uint8Array(N); // 0 = IDLE
    this.predictedPeakPgvs = new Float32Array(N);
    this.predictedContinuousIntensities = new Float32Array(N);
    this.predictedIntensities = new Array<JmaIntensityScale | undefined>(N);
    this.maximumObservedPgvs = new Float32Array(N);

    const hypo = config.hypocenter;
    const noiseStdDev = config.noiseStdDev ?? 0.15;

    for (let i = 0; i < N; i++) {
      const stLat = this.stations.lats[i];
      const stLon = this.stations.lons[i];

      // Slab geometry affects attenuation only; travel times come from JMA tables.
      const rSlab = calculateSlabFraction(hypo.lat, hypo.lon, hypo.depth, stLat, stLon, this.slabModel);
      this.slabFractions[i] = rSlab;

      const travelTimes = computeTravelTimes(hypo, stLat, stLon, rSlab);
      this.hypocentralDists[i] = travelTimes.hypocentralDistance;
      this.pArrivalTimes[i] = travelTimes.pArrivalTime;
      this.sArrivalTimes[i] = travelTimes.sArrivalTime;
      // Add a small Gaussian pick error to mimic real station arrival-time picking variability.
      const noise = generateGaussianNoise(noiseStdDev);
      this.pObservedTimes[i] = Math.max(0.0, this.pArrivalTimes[i] + noise);
    }

    this.pArrivalOrder = Uint32Array.from(
      Array.from({ length: N }, (_, index) => index)
        .sort((left, right) => this.pObservedTimes[left] - this.pObservedTimes[right])
    );
    this.reset();
  }

  public reset(): void {
    this.simTime = 0.0;
    this.isRunning = false;
    this.stationStates.fill(0);
    this.predictedPeakPgvs.fill(0);
    this.predictedContinuousIntensities.fill(0);
    this.predictedIntensities.fill(undefined);
    this.maximumObservedPgvs.fill(0);
    this.nextPArrivalIndex = 0;
    this.activeStationIndices = [];
    this.activeStationCount = 0;
  }

  public setTimeScale(scale: number): void {
    if (this.config) {
      this.config.timeScale = Math.max(0.1, scale);
    }
  }

  public seek(timeSeconds: number): SimulationTickState {
    this.reset();

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

    const pWaveRadiusKm = computeWavefrontRadiusKm(elapsedTime, hypo.depth, 'P');
    const sWaveRadiusKm = computeWavefrontRadiusKm(elapsedTime, hypo.depth, 'S');

    const newTriggers: StationTriggerEvent[] = [];
    const intensityUpdates: IntensityUpdate[] = [];
    const activeStationCountBeforeUpdate = this.activeStationIndices.length;

    while (this.nextPArrivalIndex < this.pArrivalOrder.length) {
      const i = this.pArrivalOrder[this.nextPArrivalIndex];
      const pObs = this.pObservedTimes[i];
      if (pObs > this.simTime) break;
      this.nextPArrivalIndex++;

      if (this.stationStates[i] !== StationState.IDLE) continue;

      // P-wave trigger: a station transitions from silent to activated once its modeled arrival time is reached.
      this.stationStates[i] = StationState.P_TRIGGERED;
      this.activeStationIndices.push(i);
      this.activeStationCount++;

      const stLat = this.stations.lats[i];
      const stLon = this.stations.lons[i];
      const arv = this.stations.ampFactors[i];
      const rSlab = this.slabFractions[i];
      const faultDist = pointSourceDistance(stLat, stLon, hypo.lat, hypo.lon, hypo.depth);
      const {
        pgvSurface: predictedPeakPgv,
        continuousIntensity: predictedContinuousIntensity,
        jmaScale: predictedIntensity
      } = calculateJmaIntensity(
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

      this.predictedPeakPgvs[i] = predictedPeakPgv;
      this.predictedContinuousIntensities[i] = predictedContinuousIntensity;
      this.predictedIntensities[i] = predictedIntensity;

      const sArr = this.sArrivalTimes[i];
      const observedPgv = envelope(this.simTime, pObs, sArr, hypo.magnitude, predictedPeakPgv);
      const continuousIntensity = calculateContinuousJmaIntensity(observedPgv);
      const observedIntensity = quantizeJmaIntensity(continuousIntensity);
      this.maximumObservedPgvs[i] = Math.max(this.maximumObservedPgvs[i], observedPgv);
      const maximumObservedIntensity = quantizeJmaIntensity(
        calculateContinuousJmaIntensity(this.maximumObservedPgvs[i])
      );
      const observedAmplitudeFraction = waveformAmplitudeFraction(
        this.simTime,
        pObs,
        sArr,
        hypo.magnitude
      );

      newTriggers.push({
        stationIndex: i,
        state: StationState.P_TRIGGERED,
        triggerTime: pObs,
        pArrivalTime: this.pArrivalTimes[i],
        sArrivalTime: sArr,
        pgvSurface: observedPgv,
        observedPgv,
        observedIntensity,
        maximumObservedPgv: this.maximumObservedPgvs[i],
        maximumObservedIntensity,
        intensity: observedIntensity,
        continuousIntensity,
        observedAmplitudeFraction
      });
    }

    for (let activeIndex = 0; activeIndex < this.activeStationIndices.length; activeIndex++) {
      const i = this.activeStationIndices[activeIndex];
      const pObs = this.pObservedTimes[i];
      const sArr = this.sArrivalTimes[i];

      if (
        activeIndex < activeStationCountBeforeUpdate &&
        this.stationStates[i] === StationState.P_TRIGGERED &&
        this.simTime >= sArr
      ) {
        // S-wave trigger: once the S-wave arrives, the station enters a stronger state that often
        // correlates with stronger shaking and more severe EEW intensity estimates.
        this.stationStates[i] = StationState.S_ARRIVED;

        const predictedPeakPgv = this.predictedPeakPgvs[i];
        const predictedContinuousIntensity = this.predictedContinuousIntensities[i];
        const predictedIntensity = this.predictedIntensities[i];
        const observedPgv = envelope(this.simTime, pObs, sArr, hypo.magnitude, predictedPeakPgv);
        const continuousIntensity = calculateContinuousJmaIntensity(observedPgv);
        const observedIntensity = quantizeJmaIntensity(continuousIntensity);
        this.maximumObservedPgvs[i] = Math.max(this.maximumObservedPgvs[i], observedPgv);
        const maximumObservedIntensity = quantizeJmaIntensity(
          calculateContinuousJmaIntensity(this.maximumObservedPgvs[i])
        );
        const observedAmplitudeFraction = waveformAmplitudeFraction(
          this.simTime,
          pObs,
          sArr,
          hypo.magnitude
        );

        newTriggers.push({
          stationIndex: i,
          state: StationState.S_ARRIVED,
          triggerTime: sArr,
          pArrivalTime: this.pArrivalTimes[i],
          sArrivalTime: sArr,
          pgvSurface: observedPgv,
          observedPgv,
          observedIntensity,
          maximumObservedPgv: this.maximumObservedPgvs[i],
          maximumObservedIntensity,
          predictedPeakPgv,
          intensity: observedIntensity,
          continuousIntensity,
          predictedIntensity,
          predictedContinuousIntensity,
          observedAmplitudeFraction
        });
      }

      const predictedPeakPgv = this.predictedPeakPgvs[i];
      const observedPgv = envelope(this.simTime, pObs, sArr, hypo.magnitude, predictedPeakPgv);
      const continuousIntensity = calculateContinuousJmaIntensity(observedPgv);
      const observedIntensity = quantizeJmaIntensity(continuousIntensity);
      this.maximumObservedPgvs[i] = Math.max(this.maximumObservedPgvs[i], observedPgv);
      const maximumObservedIntensity = quantizeJmaIntensity(
        calculateContinuousJmaIntensity(this.maximumObservedPgvs[i])
      );
      intensityUpdates.push({
        stationIndex: i,
        continuousIntensity,
        observedContinuousIntensity: continuousIntensity,
        observedIntensity,
        observedPgv,
        maximumObservedContinuousIntensity: calculateContinuousJmaIntensity(
          this.maximumObservedPgvs[i]
        ),
        maximumObservedIntensity,
        maximumObservedPgv: this.maximumObservedPgvs[i],
        observedAmplitudeFraction: waveformAmplitudeFraction(
          this.simTime,
          pObs,
          sArr,
          hypo.magnitude
        ),
        pgvSurface: observedPgv
      });
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

  public getActiveStationCount(): number {
    return this.activeStationCount;
  }
}
