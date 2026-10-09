import { describe, expect, it } from 'vitest';
import { createSimulationConfig, DEFAULT_HYPOCENTER, shouldPlayEewWarningChime } from './simulationState';

describe('simulationState', () => {
  it('plays a warning chime only on the first warning transition', () => {
    const previous = { reportNumber: 1, isFinal: false, isWarning: false, estimatedHypocenter: DEFAULT_HYPOCENTER, originTime: 0, triggeredStationCount: 0, maxPredictedIntensity: '4' as const, warnedPrefectures: [] };
    const next = { ...previous, isWarning: true };

    expect(shouldPlayEewWarningChime(previous, next)).toBe(true);
    expect(shouldPlayEewWarningChime(next, next)).toBe(false);
    expect(shouldPlayEewWarningChime(next, { ...next, isWarning: false })).toBe(false);
  });

  it('creates simulation config with default runtime values', () => {
    const config = createSimulationConfig(DEFAULT_HYPOCENTER, 2.5);

    expect(config.hypocenter).toBe(DEFAULT_HYPOCENTER);
    expect(config.timeScale).toBe(2.5);
    expect(config.tickIntervalMs).toBe(50);
    expect(config.noiseStdDev).toBe(0.15);
  });
});
