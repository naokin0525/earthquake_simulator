/**
 * src/core/simulation/EventSequencer.ts
 * ====================================
 * Manages the chronological sequence of JMA bulletins and milestones.
 * Decouples the simulation clock from the business logic of broadcast reports.
 */

import {
  SimulationMilestone,
  SimulationMilestoneType,
  EEWReport,
  IntensityFlashReport,
  EarthquakeInfoReport,
  LPGMReport,
  JmaIntensityScale,
  EarthquakeHypocenter,
  StationState,
  StationTriggerEvent
} from '../types';
import { PREFECTURE_CENTROIDS } from '../eew/EEWEngine';
import { isJmaGreaterOrEqual } from '../physics/attenuation';
import { estimateLPGM } from '../physics/lpgm';
import { Slab2Model } from '../physics/slabModel';

const SUB_REGION_GEOJSON_URL = new URL(
  '../../../data_references/20240520_AreaForecastLocalE_GIS/sub_regions.geojson',
  import.meta.url
).toString();

export type SequencerEvent =
  | { type: 'EEW_WARNING_TRIGGERED'; payload: EEWReport }
  | { type: 'FLASH_REPORT'; payload: IntensityFlashReport }
  | { type: 'EARTHQUAKE_INFO'; payload: EarthquakeInfoReport }
  | { type: 'LPGM_REPORT'; payload: LPGMReport }
  | { type: 'FINAL_REPORT'; payload: EEWReport };

export function estimateEpicenterRegionName(lat: number, lon: number): string {
  // Specific bay / sea area naming
  if (lat >= 34.8 && lat <= 35.7 && lon >= 139.6 && lon <= 140.1) return '東京湾';
  if (lat >= 34.7 && lat <= 35.3 && lon >= 139.1 && lon <= 139.7) return '相模湾';
  if (lat >= 34.5 && lat <= 35.2 && lon >= 138.3 && lon <= 138.9) return '駿河湾';
  if (lat >= 34.3 && lat <= 35.0 && lon >= 136.6 && lon <= 137.3) return '伊勢湾';
  if (lat >= 34.2 && lat <= 34.8 && lon >= 134.8 && lon <= 135.5) return '大阪湾';
  if (lat >= 33.3 && lat <= 34.2 && lon >= 134.5 && lon <= 135.5) return '紀伊水道';
  if (lat >= 33.5 && lat <= 34.3 && lon >= 132.0 && lon <= 132.8) return '伊予灘';
  if (lat >= 33.0 && lat <= 33.6 && lon >= 131.8 && lon <= 132.5) return '豊後水道';
  if (lat >= 31.0 && lat <= 33.0 && lon >= 131.5 && lon <= 133.0) return '日向灘';
  if (lat >= 32.5 && lat <= 34.5 && lon >= 136.0 && lon <= 138.5) return '東海道南方沖';
  if (lat >= 36.5 && lat <= 38.0 && lon >= 141.0 && lon <= 143.0) return '福島県沖';
  if (lat >= 38.0 && lat <= 39.0 && lon >= 141.5 && lon <= 143.5) return '宮城県沖';
  if (lat >= 39.0 && lat <= 40.5 && lon >= 141.8 && lon <= 144.0) return '岩手県沖';
  if (lat >= 40.5 && lat <= 42.0 && lon >= 141.5 && lon <= 144.5) return '青森県東方沖';
  if (lat >= 37.0 && lat <= 37.8 && lon >= 136.5 && lon <= 137.8) return '能登半島沖';
  if (lat >= 37.0 && lat <= 38.5 && lon >= 138.0 && lon <= 139.5) return '新潟県中越沖';

  let closestPref = PREFECTURE_CENTROIDS[1];
  let minDist = 999999;
  for (const pref of Object.values(PREFECTURE_CENTROIDS)) {
    const d = Math.hypot(pref.lat - lat, (pref.lon - lon) * Math.cos(lat * Math.PI / 180)) * 111;
    if (d < minDist) {
      minDist = d;
      closestPref = pref;
    }
  }

  if (minDist > 75) {
    return `${closestPref.name}沖`;
  }
  return `${closestPref.name}付近`;
}

export class EventSequencer {
  constructor(private readonly slabModel?: Slab2Model) {
    this.loadSubRegions();
  }

  private milestones: Map<SimulationMilestoneType, SimulationMilestone> = new Map();
  private subRegions: Array<{ code: string; name: string; lat: number; lon: number }> = [];
  private sArrivedStations = new Set<number>();
  private maxIntensityByPrefecture = new Map<number, JmaIntensityScale>();
  private maxIntensityByRegion = new Map<string, JmaIntensityScale>();
  private isWarningIssued = false;
  private isFlashReportIssued = false;
  private isEarthquakeInfoIssued = false;
  private isLpgmReportIssued = false;
  private isFinalReportIssued = false;
  private isUsingSubRegionBreakdown = false;
  private lastFlashReport: { issuedTime: number; maxIntensity: JmaIntensityScale; regionNames: Set<string> } | null = null;

  public reset(): void {
    this.milestones.clear();
    this.sArrivedStations.clear();
    this.maxIntensityByPrefecture.clear();
    this.maxIntensityByRegion.clear();
    this.isWarningIssued = false;
    this.isFlashReportIssued = false;
    this.isEarthquakeInfoIssued = false;
    this.isLpgmReportIssued = false;
    this.isFinalReportIssued = false;
    this.isUsingSubRegionBreakdown = false;
    this.lastFlashReport = null;
  }

  /**
   * Evaluates simulation state and emits new JMA events.
   */
  public update(
    simTime: number,
    triggeredCount: number,
    eewReport: EEWReport | null,
    hypo: EarthquakeHypocenter | undefined,
    newTriggers: readonly StationTriggerEvent[],
    stationPrefCodes: Uint8Array,
    stationLats?: Float32Array,
    stationLons?: Float32Array
  ): {
    event?: SequencerEvent;
    milestone?: SimulationMilestone
  } {
    this.recordSArrivals(newTriggers, stationPrefCodes, stationLats, stationLons);

    // 1. Origin (t=0)
    if (simTime === 0) {
      return this.emitMilestone('ORIGIN', 0, '地震発生');
    }

    // 2. First Ground Shaking Detected (P-wave detected)
    if (triggeredCount === 1 && !this.milestones.has('FIRST_TRIGGER')) {
      return this.emitMilestone('FIRST_TRIGGER', simTime, '揺れの検知 (P波初検知)');
    }

    // 3. EEW Forecast logic
    if (eewReport && eewReport.reportNumber === 1 && !this.milestones.has('EEW_FORECAST')) {
      return this.emitMilestone('EEW_FORECAST', simTime, '緊急地震速報 (予報) 第1報');
    }

    // 4. EEW Warning (Predicted Intensity >= 5- or LPGM >= 3 across 2+ stations)
    if (eewReport && eewReport.isWarning && !this.isWarningIssued) {
      this.isWarningIssued = true;
      this.emitMilestone('EEW_WARNING', simTime, '緊急地震速報 (警報) 発表');
      return {
        event: { type: 'EEW_WARNING_TRIGGERED', payload: eewReport },
        milestone: this.milestones.get('EEW_WARNING')!
      };
    }

    // 5. 震度速報: issue around 90 seconds for observed intensity 3+ and allow follow-up reports
    // when the intensity increases or new affected regions are confirmed.
    if (simTime >= 90.0 && this.hasObservedIntensityAtLeast('3')) {
      const report = this.generateFlashReport(simTime);
      if (report && this.shouldIssueFlashReport(report, simTime)) {
        this.isFlashReportIssued = true;
        this.lastFlashReport = {
          issuedTime: simTime,
          maxIntensity: report.maxIntensity,
          regionNames: new Set(report.prefectures.map((p) => p.prefName))
        };
        this.emitMilestone('FLASH_REPORT', simTime, '震度速報 (約1分半後)');
        return {
          event: { type: 'FLASH_REPORT', payload: report },
          milestone: this.milestones.get('FLASH_REPORT')!
        };
      }
    }

    // 6. 震源・震度情報: issue within a few minutes for intensity 1+ or an EEW public warning.
    if (
      simTime >= 180.0 &&
      hypo &&
      !this.isEarthquakeInfoIssued &&
      (this.hasObservedIntensityAtLeast('1') || eewReport?.isWarning)
    ) {
      const report = this.generateEarthquakeInfoReport(simTime, hypo);
      this.isEarthquakeInfoIssued = true;
      this.emitMilestone('EARTHQUAKE_INFO', simTime, '震源・震度情報 (約3分後)');
      return {
        event: { type: 'EARTHQUAKE_INFO', payload: report },
        milestone: this.milestones.get('EARTHQUAKE_INFO')!
      };
    }

    // 7. 長周期地震動に関する観測情報: issue around 10 minutes for observed intensity 1+ and LPGM class 1+.
    if (
      simTime >= 600.0 &&
      hypo &&
      !this.isLpgmReportIssued &&
      this.hasObservedIntensityAtLeast('1')
    ) {
      const report = this.generateLpgmReport(simTime, hypo);
      if (report.affectedPrefectures.length > 0) {
        this.isLpgmReportIssued = true;
        this.emitMilestone('LPGM_REPORT', simTime, '長周期地震動に関する観測情報 (約10分後)');
        return {
          event: { type: 'LPGM_REPORT', payload: report },
          milestone: this.milestones.get('LPGM_REPORT')!
        };
      }
    }

    // 8. EEW Final Report
    if (eewReport && eewReport.isFinal && !this.isFinalReportIssued) {
      this.isFinalReportIssued = true;
      this.emitMilestone('FINAL_REPORT', simTime, '緊急地震速報 最終報');
      return {
        event: { type: 'FINAL_REPORT', payload: eewReport },
        milestone: this.milestones.get('FINAL_REPORT')!
      };
    }

    return {};
  }

  private hasObservedIntensityAtLeast(threshold: JmaIntensityScale): boolean {
    const regionalValues = Array.from(this.maxIntensityByRegion.values());
    const prefecturalValues = Array.from(this.maxIntensityByPrefecture.values());
    return [...regionalValues, ...prefecturalValues].some((intensity) =>
      isJmaGreaterOrEqual(intensity, threshold)
    );
  }

  private shouldIssueFlashReport(report: IntensityFlashReport, simTime: number): boolean {
    if (!this.lastFlashReport) {
      return true;
    }

    const previousRegions = this.lastFlashReport.regionNames;
    const regionAdded = report.prefectures.some((entry) => !previousRegions.has(entry.prefName));
    const intensityAdded = report.maxIntensity !== this.lastFlashReport.maxIntensity &&
      isJmaGreaterOrEqual(report.maxIntensity, this.lastFlashReport.maxIntensity);

    return regionAdded || intensityAdded;
  }

  private emitMilestone(type: SimulationMilestoneType, time: number, label: string): { milestone: SimulationMilestone } {
    const milestone: SimulationMilestone = { type, time, label };
    this.milestones.set(type, milestone);
    return { milestone };
  }

  private recordSArrivals(
    newTriggers: readonly StationTriggerEvent[],
    stationPrefCodes: Uint8Array,
    stationLats?: Float32Array,
    stationLons?: Float32Array
  ): void {
    for (const trigger of newTriggers) {
      const { stationIndex } = trigger;
      if (
        trigger.state !== StationState.S_ARRIVED ||
        !Number.isInteger(stationIndex) ||
        stationIndex < 0 ||
        stationIndex >= stationPrefCodes.length
      ) {
        continue;
      }

      const prefCode = stationPrefCodes[stationIndex];
      const prefecture = PREFECTURE_CENTROIDS[prefCode];
      const regionName = this.resolveRegionName(stationIndex, stationLats, stationLons, prefCode, prefecture?.name);
      if (!regionName) continue;
      if (stationLats && stationLons && regionName !== prefecture?.name) {
        this.isUsingSubRegionBreakdown = true;
      }

      this.sArrivedStations.add(stationIndex);
      const intensity = trigger.instrumentalIntensityScale ?? trigger.intensity;
      const currentMax = this.maxIntensityByRegion.get(regionName) ?? this.maxIntensityByPrefecture.get(prefCode);
      if (!currentMax || isJmaGreaterOrEqual(intensity, currentMax)) {
        this.maxIntensityByRegion.set(regionName, intensity);
        this.maxIntensityByPrefecture.set(prefCode, intensity);
      }
    }
  }

  private resolveRegionName(
    stationIndex: number,
    stationLats?: Float32Array,
    stationLons?: Float32Array,
    prefCode?: number,
    fallbackName?: string
  ): string | null {
    if (stationLats && stationLons && stationIndex >= 0 && stationIndex < stationLats.length && stationIndex < stationLons.length) {
      const lat = stationLats[stationIndex];
      const lon = stationLons[stationIndex];
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const region = this.findNearestRegion(lat, lon);
        if (region) {
          return region.name;
        }
      }
    }

    if (typeof prefCode === 'number') {
      return PREFECTURE_CENTROIDS[prefCode]?.name ?? fallbackName ?? null;
    }

    return fallbackName ?? null;
  }

  private loadSubRegions(): void {
    if (typeof fetch !== 'function') return;

    fetch(SUB_REGION_GEOJSON_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load sub-region GeoJSON: ${response.status}`);
        return response.json();
      })
      .then((geojson: { features?: Array<{ properties?: { code?: string; name?: string }; geometry?: any }> }) => {
        const features = geojson.features ?? [];
        const entries: Array<{ code: string; name: string; lat: number; lon: number }> = [];

        for (const feature of features) {
          const properties = feature.properties ?? {};
          const code = properties.code ?? '';
          const name = properties.name ?? '';
          if (!code && !name) continue;

          const centroid = this.calculateFeatureCentroid(feature.geometry);
          if (!centroid) continue;

          entries.push({ code, name, lat: centroid.lat, lon: centroid.lon });
        }

        this.subRegions = entries;
      })
      .catch(() => {
        this.subRegions = [];
      });
  }

  private calculateFeatureCentroid(geometry: any): { lat: number; lon: number } | null {
    if (!geometry) return null;

    const coords: Array<[number, number]> = [];
    const collect = (ring: any): void => {
      if (!Array.isArray(ring)) return;
      for (const point of ring) {
        if (Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])) {
          coords.push([point[0], point[1]]);
        } else if (Array.isArray(point)) {
          collect(point);
        }
      }
    };

    if (geometry.type === 'Polygon') {
      for (const ring of geometry.coordinates) {
        collect(ring);
      }
    } else if (geometry.type === 'MultiPolygon') {
      for (const polygon of geometry.coordinates) {
        for (const ring of polygon) {
          collect(ring);
        }
      }
    } else {
      return null;
    }

    if (coords.length === 0) return null;

    let lat = 0;
    let lon = 0;
    for (const [lng, latCoord] of coords) {
      lon += lng;
      lat += latCoord;
    }

    return {
      lat: lat / coords.length,
      lon: lon / coords.length
    };
  }

  private findNearestRegion(lat: number, lon: number): { code: string; name: string; lat: number; lon: number } | null {
    const regionEntries = this.subRegions.length > 0
      ? this.subRegions
      : Object.values(PREFECTURE_CENTROIDS).map((prefecture) => ({
          code: String(prefecture.name),
          name: prefecture.name,
          lat: prefecture.lat,
          lon: prefecture.lon
        }));

    let closest = null;
    let minDistance = Number.POSITIVE_INFINITY;
    for (const region of regionEntries) {
      const distance = Math.hypot(region.lat - lat, region.lon - lon);
      if (distance < minDistance) {
        minDistance = distance;
        closest = region;
      }
    }

    return closest;
  }

  private generateFlashReport(time: number): IntensityFlashReport | null {
    const regionEntries = (this.maxIntensityByRegion.size > 0 ? this.maxIntensityByRegion : this.maxIntensityByPrefecture) as Map<string | number, JmaIntensityScale>;
    if (regionEntries.size === 0) return null;

    const intensities: IntensityFlashReport['intensities'] = {};
    const prefectures: IntensityFlashReport['prefectures'] = [];
    let maxIntensity: JmaIntensityScale = '0';

    for (const [regionKey, intensity] of regionEntries) {
      const regionName = regionKey.toString();
      const regionCode = Number(regionKey);
      if (isJmaGreaterOrEqual(intensity, '3')) {
        intensities[intensity] ??= [];
        intensities[intensity]!.push(regionName);
        prefectures.push({
          prefCode: Number.isFinite(regionCode) ? regionCode : 0,
          prefName: regionName,
          maxIntensity: intensity
        });
      }

      if (isJmaGreaterOrEqual(intensity, maxIntensity)) {
        maxIntensity = intensity;
      }
    }

    const regionLabel = this.isUsingSubRegionBreakdown ? '地域' : '都道府県';

    return {
      issuedTime: time,
      maxIntensity,
      intensities,
      prefectures,
      summary: `観測点${this.sArrivedStations.size}地点のS波到達を集計。${regionEntries.size}${regionLabel}の最大震度は${maxIntensity}相当です。`
    };
  }

  private generateEarthquakeInfoReport(time: number, hypo: EarthquakeHypocenter): EarthquakeInfoReport {
    const regionEntries = (this.maxIntensityByRegion.size > 0 ? this.maxIntensityByRegion : this.maxIntensityByPrefecture) as Map<string | number, JmaIntensityScale>;
    const intensities: EarthquakeInfoReport['intensities'] = {};
    const prefectures: EarthquakeInfoReport['prefectures'] = [];
    let maxIntensity: JmaIntensityScale = '0';

    for (const [regionKey, intensity] of regionEntries) {
      const regionName = regionKey.toString();
      const regionCode = Number(regionKey);
      if (isJmaGreaterOrEqual(intensity, '1')) {
        intensities[intensity] ??= [];
        intensities[intensity]!.push(regionName);
        prefectures.push({
          prefCode: Number.isFinite(regionCode) ? regionCode : 0,
          prefName: regionName,
          maxIntensity: intensity
        });
      }

      if (isJmaGreaterOrEqual(intensity, maxIntensity)) {
        maxIntensity = intensity;
      }
    }

    const epicenterName = estimateEpicenterRegionName(hypo.lat, hypo.lon);

    return {
      issuedTime: time,
      hypocenter: hypo,
      epicenterName,
      maxIntensity,
      intensities,
      prefectures,
      summary: `震源地は${epicenterName}、深さ約${Math.round(hypo.depth)}km、地震の規模(M)${hypo.magnitude.toFixed(1)}。最大震度${maxIntensity}を観測しました。`
    };
  }

  private generateLpgmReport(time: number, hypo: EarthquakeHypocenter): LPGMReport {
    const affectedPrefectures: LPGMReport['affectedPrefectures'] = [];
    let maxClass: 1 | 2 | 3 | 4 = 1;

    for (const [code, prefecture] of Object.entries(PREFECTURE_CENTROIDS)) {
      const result = estimateLPGM(
        hypo,
        prefecture.lat,
        prefecture.lon,
        prefecture.defaultArv,
        this.slabModel
      );
      if (result.classLevel === 0) continue;

      if (result.classLevel > maxClass) {
        maxClass = result.classLevel;
      }

      affectedPrefectures.push({
        prefCode: Number(code),
        prefName: prefecture.name,
        classLevel: result.classLevel
      });
    }

    return {
      issuedTime: time,
      maxClass,
      affectedPrefectures
    };
  }

  public getMilestones(): SimulationMilestone[] {
    return Array.from(this.milestones.values()).sort((a, b) => a.time - b.time);
  }
}
