/**
 * src/core/viz/MapLayers.ts
 * ========================
 * Configuration and logic for map layers in the simulation.
 */
import { EEWReport, StationState } from '../types';

export const JAPAN_LANDMASS_LAYER_ID = 'japan-landmass';

/**
 * Logic for highlighting warned prefectures on the GeoJsonLayer.
 */
export function getPrefectureFillColor(feature: any, report: EEWReport | null): [number, number, number, number] {
  if (report && report.warnedPrefectures) {
    const prefCode = feature?.properties?.pref;
    const prefWarn = report.warnedPrefectures.find((p: any) => p.prefCode === prefCode);
    if (prefWarn && prefWarn.isWarning) {
      return [220, 38, 38, 190]; // Highlight affected alert area with rich red
    }
  }
  return [20, 30, 48, 255];
}

export function getPrefectureLineColor(feature: any, report: EEWReport | null): [number, number, number, number] {
  if (report && report.warnedPrefectures) {
    const prefCode = feature?.properties?.pref;
    const prefWarn = report.warnedPrefectures.find((p: any) => p.prefCode === prefCode);
    if (prefWarn && prefWarn.isWarning) {
      return [254, 240, 138, 255]; // Glowing bright outline for affected warning prefectures
    }
  }
  return [60, 90, 130, 180];
}

export function getPrefectureLineWidth(feature: any, report: EEWReport | null): number {
  if (report && report.warnedPrefectures) {
    const prefCode = feature?.properties?.pref;
    const prefWarn = report.warnedPrefectures.find((p: any) => p.prefCode === prefCode);
    if (prefWarn && prefWarn.isWarning) {
      return 3;
    }
  }
  return 1;
}
