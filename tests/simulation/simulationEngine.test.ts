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

    // Tick at t=0.5s: station 0 still IDLE
    let tick = engine.update(0.5);
    expect(tick.simTime).toBe(0.5);
    expect(tick.pWaveRadiusKm).toBeCloseTo(3.0, 1);
    expect(tick.sWaveRadiusKm).toBeCloseTo(1.75, 1);
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
    expect(tick.pWaveRadiusKm).toBeCloseTo(30.0, 1);
  });
});
