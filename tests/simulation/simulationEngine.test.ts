/**
 * tests/simulation/simulationEngine.test.ts
 * ==========================================
 * Unit tests validating station state transitions and ground truth wave front propagation.
 */

import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../../src/core/simulation/SimulationEngine';
import { StationDataBuffer, StationState } from '../../src/core/types';

describe('SimulationEngine State Machine & Wave Propagation', () => {
  // Mock 3 stations
  const mockStations: StationDataBuffer = {
    totalStations: 3,
    lats: new Float32Array([35.5, 35.8, 36.5]),
    lons: new Float32Array([139.5, 139.7, 140.2]),
    ampFactors: new Float32Array([1.5, 1.8, 1.2]),
    prefCodes: new Uint8Array([13, 11, 8])
  };

  it('should initialize stations in IDLE state', () => {
    const engine = new SimulationEngine(mockStations);
    const states = engine.getStationStates();
    expect(states[0]).toBe(StationState.IDLE);
    expect(states[1]).toBe(StationState.IDLE);
    expect(states[2]).toBe(StationState.IDLE);
  });

  it('should advance wave radii and transition station states from IDLE to P_TRIGGERED and S_ARRIVED', () => {
    const engine = new SimulationEngine(mockStations);
    engine.init({
      hypocenter: { lat: 35.5, lon: 139.5, depth: 10.0, magnitude: 6.5, originTime: 0.0 },
      timeScale: 1.0,
      tickIntervalMs: 50,
      noiseStdDev: 0.0 // Zero noise for deterministic test
    });

    // At t=0.0s, station 0 (directly above hypocenter at 10km depth)
    // P arrival = 10km / 6.0km/s = ~1.67s
    // S arrival = 10km / 3.5km/s = ~2.86s

    // Tick at t=0.5s: station 0 still IDLE (wave has not reached surface yet)
    let tick = engine.update(0.5);
    expect(tick.simTime).toBe(0.5);
    expect(tick.pWaveRadiusKm).toBeCloseTo(0.0, 1);
    expect(tick.sWaveRadiusKm).toBeCloseTo(0.0, 1);
    expect(engine.getStationStates()[0]).toBe(StationState.IDLE);

    // Tick at t=2.0s: station 0 P-wave triggered!
    tick = engine.update(1.5); // Cumulative simTime = 2.0s
    expect(tick.simTime).toBe(2.0);
    expect(engine.getStationStates()[0]).toBe(StationState.P_TRIGGERED);
    expect(tick.newTriggers.length).toBeGreaterThanOrEqual(1);
    expect(tick.newTriggers[0].stationIndex).toBe(0);
    expect(tick.newTriggers[0].state).toBe(StationState.P_TRIGGERED);

    // Tick at t=3.5s: station 0 S-wave arrived!
    tick = engine.update(1.5); // Cumulative simTime = 3.5s
    expect(engine.getStationStates()[0]).toBe(StationState.S_ARRIVED);
  });

  it('should leave stations with predicted JMA intensity 0 inactive for deep-focus earthquakes', () => {
    const stations: StationDataBuffer = {
      totalStations: 2,
      lats: new Float32Array([37.3, 30.0]),
      lons: new Float32Array([133.9, 125.0]),
      ampFactors: new Float32Array([1, 1]),
      prefCodes: new Uint8Array([32, 47])
    };
    const engine = new SimulationEngine(stations);
    engine.init({
      hypocenter: { lat: 37.3, lon: 133.9, depth: 470, magnitude: 7.0, originTime: 0 },
      timeScale: 1,
      tickIntervalMs: 50,
      noiseStdDev: 0
    });

    const tick = engine.update(1000);

    expect(tick.newTriggers.some(({ stationIndex }) => stationIndex === 0)).toBe(true);
    expect(tick.newTriggers.some(({ stationIndex }) => stationIndex === 1)).toBe(false);
    expect(engine.getStationStates()[1]).toBe(StationState.IDLE);
  });

  it('should scale simulation time step according to timeScale multiplier', () => {
    const engine = new SimulationEngine(mockStations);
    engine.init({
      hypocenter: { lat: 35.5, lon: 139.5, depth: 10.0, magnitude: 6.5, originTime: 0.0 },
      timeScale: 5.0, // 5x speed
      tickIntervalMs: 50,
      noiseStdDev: 0.0
    });

    const tick = engine.update(1.0); // 1s wall time * 5x speed = 5.0s sim time
    expect(tick.simTime).toBe(5.0);
    expect(tick.pWaveRadiusKm).toBeCloseTo(28.28, 1);
  });

  it('should rebuild trigger events and station states when seeking in either direction', () => {
    const engine = new SimulationEngine(mockStations);
    engine.init({
      hypocenter: { lat: 35.5, lon: 139.5, depth: 10.0, magnitude: 6.5, originTime: 0.0 },
      timeScale: 1.0,
      tickIntervalMs: 50,
      noiseStdDev: 0.0
    });

    const pWaveSnapshot = engine.seek(2.0);
    expect(pWaveSnapshot.newTriggers).toHaveLength(1);
    expect(pWaveSnapshot.newTriggers[0].state).toBe(StationState.P_TRIGGERED);
    expect(engine.getStationStates()[0]).toBe(StationState.P_TRIGGERED);

    const sWaveSnapshot = engine.seek(4.0);
    expect(sWaveSnapshot.newTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stationIndex: 0, state: StationState.P_TRIGGERED }),
        expect.objectContaining({ stationIndex: 0, state: StationState.S_ARRIVED })
      ])
    );
    expect(engine.getStationStates()[0]).toBe(StationState.S_ARRIVED);

    const rewindSnapshot = engine.seek(0);
    expect(rewindSnapshot.newTriggers).toHaveLength(0);
    expect(engine.getStationStates().every((state) => state === StationState.IDLE)).toBe(true);
  });

  it('should keep population density out of modeled PGV and EEW trigger estimates', () => {
    const stationsWithDensity: StationDataBuffer = {
      ...mockStations,
      dailyNoise: new Float32Array([26664, 26664, 26664])
    };
    const config = {
      hypocenter: { lat: 35.5, lon: 139.5, depth: 10.0, magnitude: 6.5, originTime: 0.0 },
      timeScale: 1.0,
      tickIntervalMs: 50,
      noiseStdDev: 0.0
    };
    const cleanEngine = new SimulationEngine(mockStations);
    const densityEngine = new SimulationEngine(stationsWithDensity);
    cleanEngine.init(config);
    densityEngine.init(config);

    const cleanTick = cleanEngine.update(2.0);
    const densityTick = densityEngine.update(2.0);
    const cleanTrigger = cleanTick.newTriggers.find((trigger) => trigger.stationIndex === 0);
    const densityTrigger = densityTick.newTriggers.find((trigger) => trigger.stationIndex === 0);

    expect(cleanTrigger).toBeDefined();
    expect(densityTrigger).toBeDefined();
    expect(densityTrigger?.pgvSurface).toBe(cleanTrigger?.pgvSurface);
    expect(densityTrigger?.accelerationGal).toBe(cleanTrigger?.accelerationGal);
    expect(densityTick.intensityUpdates?.[0].pgvSurface).toBe(cleanTick.intensityUpdates?.[0].pgvSurface);
  });
});
