import type { EEWReport, EarthquakeHypocenter, SimulationConfig } from './types';

export const DEFAULT_HYPOCENTER: EarthquakeHypocenter = {
  lat: 35.5,
  lon: 139.5,
  depth: 20.0,
  magnitude: 6.8,
  originTime: 0.0
};

export const createSimulationConfig = (
  hypocenter: EarthquakeHypocenter,
  timeScale: number
): SimulationConfig => ({
  hypocenter,
  timeScale,
  tickIntervalMs: 50,
  noiseStdDev: 0.15
});

export const shouldPlayEewWarningChime = (
  previousReport: EEWReport | null,
  nextReport: EEWReport | null
): boolean => Boolean(nextReport?.isWarning && !previousReport?.isWarning);
