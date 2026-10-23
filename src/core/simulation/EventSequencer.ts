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
  private milestones: Map<SimulationMilestoneType, SimulationMilestone> = new Map();
  private sArrivedStations = new Set<number>();
  private maxIntensityByPrefecture = new Map<number, JmaIntensityScale>();
  private isWarningIssued = false;
  private isFlashReportIssued = false;
  private isEarthquakeInfoIssued = false;
  private isLpgmReportIssued = false;
  private isFinalReportIssued = false;

  public reset(): void {
    this.milestones.clear();
    this.sArrivedStations.clear();
    this.maxIntensityByPrefecture.clear();
    this.isWarningIssued = false;
    this.isFlashReportIssued = false;
    this.isEarthquakeInfoIssued = false;
    this.isLpgmReportIssued = false;
    this.isFinalReportIssued = false;
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
    stationPrefCodes: Uint8Array
  ): {
    event?: SequencerEvent;
    milestone?: SimulationMilestone
  } {
    this.recordSArrivals(newTriggers, stationPrefCodes);

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

    // 5. 震度速報 (Intensity Flash Report): JMA standard is approx. 1.5 - 2 minutes (~70 - 100s) or upon 50+ S-wave arrivals
    if ((simTime >= 70.0 || this.sArrivedStations.size >= 50) && !this.isFlashReportIssued) {
      const hasIntensity3Plus = Array.from(this.maxIntensityByPrefecture.values()).some((int) =>
        isJmaGreaterOrEqual(int, '3')
      );

      if (hasIntensity3Plus || this.sArrivedStations.size >= 50 || simTime >= 110.0) {
        const report = this.generateFlashReport(simTime);
        if (report) {
          this.isFlashReportIssued = true;
          this.emitMilestone('FLASH_REPORT', simTime, '震度速報 (約1分半後)');
          return {
            event: { type: 'FLASH_REPORT', payload: report },
            milestone: this.milestones.get('FLASH_REPORT')!
          };
        }
      }
    }

    // 6. 震源・震度情報 (Earthquake and Intensity Information): JMA standard is approx. 3 - 5 minutes (~180 - 240s)
    if (simTime >= 180.0 && hypo && !this.isEarthquakeInfoIssued) {
      const report = this.generateEarthquakeInfoReport(simTime, hypo);
      this.isEarthquakeInfoIssued = true;
      this.emitMilestone('EARTHQUAKE_INFO', simTime, '震源・震度情報 (約3分後)');
      return {
        event: { type: 'EARTHQUAKE_INFO', payload: report },
        milestone: this.milestones.get('EARTHQUAKE_INFO')!
      };
    }

    // 7. 長周期地震動に関する観測情報 (LPGM Report): JMA standard is approx. 10 minutes (~300 - 600s)
    // Only issued for M >= 6.5 and depth <= 100km after wave propagation has completed
    if (simTime >= 300.0 && hypo && hypo.magnitude >= 6.5 && hypo.depth <= 100 && !this.isLpgmReportIssued) {
      const report = this.generateLpgmReport(simTime, hypo);
      this.isLpgmReportIssued = true;
      if (report.affectedPrefectures.length > 0) {
        this.emitMilestone('LPGM_REPORT', simTime, '長周期地震動に関する観測情報 (約5分後)');
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

  private emitMilestone(type: SimulationMilestoneType, time: number, label: string): { milestone: SimulationMilestone } {
    const milestone: SimulationMilestone = { type, time, label };
    this.milestones.set(type, milestone);
    return { milestone };
  }

  private recordSArrivals(
    newTriggers: readonly StationTriggerEvent[],
    stationPrefCodes: Uint8Array
  ): void {
    for (const trigger of newTriggers) {
      const { stationIndex } = trigger;
      if (
        trigger.state !== StationState.S_ARRIVED ||
        !Number.isInteger(stationIndex) ||
        stationIndex < 0 ||
        stationIndex >= stationPrefCodes.length ||
        this.sArrivedStations.has(stationIndex)
      ) {
        continue;
      }

      const prefCode = stationPrefCodes[stationIndex];
      const prefecture = PREFECTURE_CENTROIDS[prefCode];
      if (!prefecture) continue;

      this.sArrivedStations.add(stationIndex);
      const intensity = trigger.instrumentalIntensityScale ?? trigger.intensity;
      const currentMax = this.maxIntensityByPrefecture.get(prefCode);
      if (!currentMax || isJmaGreaterOrEqual(intensity, currentMax)) {
        this.maxIntensityByPrefecture.set(prefCode, intensity);
      }
    }
  }

  private generateFlashReport(time: number): IntensityFlashReport | null {
    if (this.maxIntensityByPrefecture.size === 0) return null;

    const intensities: IntensityFlashReport['intensities'] = {};
    const prefectures: IntensityFlashReport['prefectures'] = [];
    let maxIntensity: JmaIntensityScale = '0';

    for (const [prefCode, intensity] of this.maxIntensityByPrefecture) {
      const prefecture = PREFECTURE_CENTROIDS[prefCode];
      if (!prefecture) continue;

      // Flash report only lists intensity >= 3
      if (isJmaGreaterOrEqual(intensity, '3')) {
        intensities[intensity] ??= [];
        intensities[intensity]!.push(prefecture.name);
        prefectures.push({
          prefCode,
          prefName: prefecture.name,
          maxIntensity: intensity
        });
      }

      if (isJmaGreaterOrEqual(intensity, maxIntensity)) {
        maxIntensity = intensity;
      }
    }

    return {
      issuedTime: time,
      maxIntensity,
      intensities,
      prefectures,
      summary: `観測点${this.sArrivedStations.size}地点のS波到達を集計。${this.maxIntensityByPrefecture.size}都道府県の最大震度は${maxIntensity}相当です。`
    };
  }

  private generateEarthquakeInfoReport(time: number, hypo: EarthquakeHypocenter): EarthquakeInfoReport {
    const intensities: EarthquakeInfoReport['intensities'] = {};
    const prefectures: EarthquakeInfoReport['prefectures'] = [];
    let maxIntensity: JmaIntensityScale = '0';

    for (const [prefCode, intensity] of this.maxIntensityByPrefecture) {
      const prefecture = PREFECTURE_CENTROIDS[prefCode];
      if (!prefecture) continue;

      // Full report includes intensity >= 1
      if (isJmaGreaterOrEqual(intensity, '1')) {
        intensities[intensity] ??= [];
        intensities[intensity]!.push(prefecture.name);
        prefectures.push({
          prefCode,
          prefName: prefecture.name,
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
      const result = estimateLPGM(hypo, prefecture.lat, prefecture.lon, prefecture.defaultArv);
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
