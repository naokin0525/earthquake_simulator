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
  LPGMReport,
  JmaIntensityScale,
  EarthquakeHypocenter,
  StationState,
  StationTriggerEvent
} from '../types';
import { PREFECTURE_CENTROIDS } from '../eew/EEWEngine';
import { isJmaGreaterOrEqual } from '../physics/attenuation';
import { estimateLPGM } from '../physics/lpgm';

type SequencerEvent =
  | { type: 'EEW_WARNING_TRIGGERED'; payload: EEWReport }
  | { type: 'FLASH_REPORT'; payload: IntensityFlashReport }
  | { type: 'LPGM_REPORT'; payload: LPGMReport }
  | { type: 'FINAL_REPORT'; payload: EEWReport };

export class EventSequencer {
  private milestones: Map<SimulationMilestoneType, SimulationMilestone> = new Map();
  private sArrivedStations = new Set<number>();
  private maxIntensityByPrefecture = new Map<number, JmaIntensityScale>();
  private isWarningIssued = false;
  private isFlashReportIssued = false;
  private isLpgmReportIssued = false;
  private isFinalReportIssued = false;

  public reset(): void {
    this.milestones.clear();
    this.sArrivedStations.clear();
    this.maxIntensityByPrefecture.clear();
    this.isWarningIssued = false;
    this.isFlashReportIssued = false;
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
      return this.emitMilestone('ORIGIN', 0, 'Earthquake Occurrence');
    }

    // 2. First Ground Shaking Detected
    if (triggeredCount === 1 && !this.milestones.has('FIRST_TRIGGER')) {
      return this.emitMilestone('FIRST_TRIGGER', simTime, 'Ground Shaking Detected');
    }

    // 3. EEW Forecast logic (handled by EEWEngine primarily, but sequence tracked here)
    if (eewReport && eewReport.reportNumber === 1 && !this.milestones.has('EEW_FORECAST')) {
      return this.emitMilestone('EEW_FORECAST', simTime, 'EEW Forecast #1');
    }

    // 4. EEW Warning (Predicted Intensity >= 5-)
    if (eewReport && eewReport.isWarning && !this.isWarningIssued) {
      this.isWarningIssued = true;
      this.emitMilestone('EEW_WARNING', simTime, 'EEW Warning Issued');
      return {
        event: { type: 'EEW_WARNING_TRIGGERED', payload: eewReport },
        milestone: this.milestones.get('EEW_WARNING')!
      };
    }

    // 5. Intensity report from actual simulated S-wave arrivals
    if (this.sArrivedStations.size >= 50 && !this.isFlashReportIssued) {
      const report = this.generateFlashReport(simTime);
      if (report) {
        this.isFlashReportIssued = true;
        this.emitMilestone('FLASH_REPORT', simTime, 'Intensity Flash Report');
        return {
          event: { type: 'FLASH_REPORT', payload: report },
          milestone: this.milestones.get('FLASH_REPORT')!
        };
      }
    }

    // 6. LPGM Report (Mw >= 6.5 & Depth <= 100km)
    if (hypo && hypo.magnitude >= 6.5 && hypo.depth <= 100 && !this.isLpgmReportIssued) {
      const report = this.generateLpgmReport(simTime, hypo);
      this.isLpgmReportIssued = true;
      if (report.affectedPrefectures.length > 0) {
        this.emitMilestone('LPGM_REPORT', simTime, 'Long-Period Ground Motion Report');
        return {
          event: { type: 'LPGM_REPORT', payload: report },
          milestone: this.milestones.get('LPGM_REPORT')!
        };
      }
    }

    // 7. Final Report
    if (eewReport && eewReport.isFinal && !this.isFinalReportIssued) {
      this.isFinalReportIssued = true;
      this.emitMilestone('FINAL_REPORT', simTime, 'Detailed Earthquake Information');
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
    let maxIntensity: JmaIntensityScale = '0';
    for (const [prefCode, intensity] of this.maxIntensityByPrefecture) {
      const prefecture = PREFECTURE_CENTROIDS[prefCode];
      if (!prefecture) continue;

      intensities[intensity] ??= [];
      intensities[intensity]!.push(prefecture.name);
      if (isJmaGreaterOrEqual(intensity, maxIntensity)) {
        maxIntensity = intensity;
      }
    }

    return {
      issuedTime: time,
      intensities,
      summary: `観測点${this.sArrivedStations.size}地点のS波到達を集計。${this.maxIntensityByPrefecture.size}都道府県の最大震度は${maxIntensity}相当です。`
    };
  }

  private generateLpgmReport(time: number, hypo: EarthquakeHypocenter): LPGMReport {
    const affectedPrefectures: LPGMReport['affectedPrefectures'] = [];
    for (const [code, prefecture] of Object.entries(PREFECTURE_CENTROIDS)) {
      const result = estimateLPGM(hypo, prefecture.lat, prefecture.lon);
      if (result.classLevel === 0) continue;

      affectedPrefectures.push({
        prefCode: Number(code),
        prefName: prefecture.name,
        classLevel: result.classLevel
      });
    }

    return {
      issuedTime: time,
      affectedPrefectures
    };
  }

  public getMilestones(): SimulationMilestone[] {
    return Array.from(this.milestones.values()).sort((a, b) => a.time - b.time);
  }
}
