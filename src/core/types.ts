/**
 * src/core/types.ts
 * =================
 * Data contracts, type definitions, state enums, and messaging interfaces for Phase 2.
 */

export enum StationState {
  IDLE = 0,
  P_TRIGGERED = 1,
  S_ARRIVED = 2
}

export type JmaIntensityScale = '0' | '1' | '2' | '3' | '4' | '5-' | '5+' | '6-' | '6+' | '7';

export interface LPGMReport {
  issuedTime: number;
  maxClass: 1 | 2 | 3 | 4;
  affectedPrefectures: {
    prefCode: number;
    prefName: string;
    classLevel: 1 | 2 | 3 | 4;
  }[];
}

export interface IntensityFlashReport {
  issuedTime: number;
  maxIntensity: JmaIntensityScale;
  intensities: {
    [scale in JmaIntensityScale]?: string[]; // scale -> list of prefecture names
  };
  prefectures: {
    prefCode: number;
    prefName: string;
    maxIntensity: JmaIntensityScale;
  }[];
  summary: string;
}

export interface EarthquakeInfoReport {
  issuedTime: number;
  hypocenter: EarthquakeHypocenter;
  epicenterName: string;
  maxIntensity: JmaIntensityScale;
  intensities: {
    [scale in JmaIntensityScale]?: string[];
  };
  prefectures: {
    prefCode: number;
    prefName: string;
    maxIntensity: JmaIntensityScale;
  }[];
  summary: string;
}

export type SimulationMilestoneType =
  | 'ORIGIN'
  | 'FIRST_TRIGGER'
  | 'EEW_FORECAST'
  | 'EEW_WARNING'
  | 'FLASH_REPORT'
  | 'EARTHQUAKE_INFO'
  | 'FINAL_REPORT'
  | 'LPGM_REPORT';

export interface SimulationMilestone {
  type: SimulationMilestoneType;
  time: number;
  label: string;
}

export interface EarthquakeHypocenter {
  lat: number;          // Latitude in degrees (WGS84)
  lon: number;          // Longitude in degrees (WGS84)
  depth: number;        // Depth in kilometers (km)
  magnitude: number;    // Moment Magnitude Mw
  originTime: number;   // Origin timestamp in seconds (t=0 baseline)
}

export interface StationTriggerEvent {
  stationIndex: number;
  state: StationState;
  triggerTime: number;         // Observed trigger timestamp in seconds
  pArrivalTime: number;       // Theoretical or noisy P arrival time
  sArrivalTime: number;       // Theoretical S arrival time
  pgvSurface: number;         // Computed peak ground velocity at surface (cm/s)
  intensity: JmaIntensityScale; // Predicted discrete JMA intensity level (backward compatible)
  continuousIntensity: number; // Predicted continuous floating point JMA intensity (backward compatible)
  predictedIntensity?: JmaIntensityScale; // Explicit predicted intensity from attenuation model
  predictedContinuousIntensity?: number; // Explicit predicted continuous intensity from attenuation model
  instrumentalIntensity?: number; // Instrumental seismic intensity from acceleration waveform (undefined if no waveform exists)
  instrumentalIntensityScale?: JmaIntensityScale; // Discrete JMA scale from instrumental intensity (undefined if no waveform exists)
  accelerationGal?: number; // Acceleration amplitude in gal (optional, for forecast condition)
}

export interface PrefectureWarning {
  prefCode: number;
  prefName: string;
  maxPredictedIntensity: JmaIntensityScale;
  isWarning: boolean; // True if警報対象 (気象庁: 全体で5弱以上予想時、震度4以上が予想される地域)
  isForecast?: boolean; // True if予報対象 (震度3以上が予想される地域)
}

export interface EEWReport {
  reportNumber: number;
  isFinal: boolean;
  isWarning: boolean;             // True if ANY prefecture has predicted intensity >= 5-
  estimatedHypocenter: EarthquakeHypocenter;
  originTime: number;             // Estimated origin time in seconds
  triggeredStationCount: number;
  maxPredictedIntensity: JmaIntensityScale;
  warnedPrefectures: PrefectureWarning[];
}

export interface SimulationConfig {
  hypocenter: EarthquakeHypocenter;
  timeScale: number;             // Simulation speed multiplier (1, 2, 5, 10)
  tickIntervalMs: number;        // Worker tick interval in ms (default: 50ms = 20Hz)
  noiseStdDev: number;           // Picking noise std dev in seconds (default: 0.15s)
}

export interface StationDataBuffer {
  totalStations: number;
  lats: Float32Array;
  lons: Float32Array;
  ampFactors: Float32Array;
  prefCodes: Uint8Array;
  dailyNoise?: Float32Array; // Population density (people/km²) for ambient display only.
}

export interface IntensityUpdate {
  stationIndex: number;
  continuousIntensity: number; // Continuous predicted intensity from attenuation model (backward compatible)
  pgvSurface: number;
  predictedContinuousIntensity?: number;
  instrumentalIntensity?: number; // Present only when acceleration waveform exists and instrumental intensity is calculated
}

export interface SimulationTickState {
  simTime: number;               // Current elapsed simulation time in seconds
  pWaveRadiusKm: number;         // Current P-wave front radius in km
  sWaveRadiusKm: number;         // Current S-wave front radius in km
  newTriggers: StationTriggerEvent[]; // Stations that updated state in this tick
  intensityUpdates?: IntensityUpdate[]; // Per-tick continuous intensity updates for active stations
  currentEEWReport: EEWReport | null; // Latest EEW report if generated/updated
}

// ==============================================================================
// Web Worker Messaging Protocol
// ==============================================================================

export type WorkerInboundAction =
  | { type: 'INIT_STATIONS'; payload: StationDataBuffer }
  | { type: 'START'; payload: SimulationConfig }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'SEEK'; payload: { time: number } }
  | { type: 'SET_SPEED'; payload: { speed: number } }
  | { type: 'RESET' };

export type WorkerOutboundEvent =
  | { type: 'READY' }
  | { type: 'TICK'; payload: SimulationTickState }
  | { type: 'EEW_ALERT'; payload: EEWReport }
  | { type: 'INTENSITY_REPORT'; payload: { prefCode: number; maxIntensity: JmaIntensityScale }[] }
  | { type: 'FLASH_REPORT'; payload: IntensityFlashReport }
  | { type: 'EARTHQUAKE_INFO'; payload: EarthquakeInfoReport }
  | { type: 'LPGM_REPORT'; payload: LPGMReport }
  | { type: 'MILESTONE'; payload: SimulationMilestone }
  | { type: 'FINISHED' }
  | { type: 'ERROR'; payload: { message: string } };
