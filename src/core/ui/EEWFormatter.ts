/**
 * src/core/ui/EEWFormatter.ts
 * =========================
 * Formatting logic for Earthquake Early Warning (EEW) banners.
 */
import { EEWReport } from '../types';

export function formatEewWarningAnnouncement(report: EEWReport): string {
  const intensityNames: Record<string, string> = {
    '5-': '5弱',
    '5+': '5強',
    '6-': '6弱',
    '6+': '6強'
  };
  const intensity = intensityNames[report.maxPredictedIntensity] ?? report.maxPredictedIntensity;
  const warnedNames = report.warnedPrefectures
    .filter((prefecture) => prefecture.isWarning)
    .map((prefecture) => prefecture.prefName);
  const areas = warnedNames.length > 0 ? `警報対象地域は${warnedNames.join('、')}です。` : '';

  return `緊急地震速報、警報です。最大予想震度は${intensity}、検知した観測点は${report.triggeredStationCount}地点です。${areas}`;
}

export interface EEWBannerStyle {
  background: string;
  borderColor: string;
  boxShadow: string;
}

/**
 * Formats the EEW report into a user-friendly text string.
 */
export function formatEEWText(report: EEWReport): string {
  const mag = report.estimatedHypocenter.magnitude.toFixed(1);
  const count = report.triggeredStationCount;
  const finalTag = report.isFinal ? ' [最終報]' : '';
  const typeTag = report.isWarning ? '【警報】' : '【予報】';

  const warnedNames = report.warnedPrefectures
    ? report.warnedPrefectures.filter(p => p.isWarning).map(p => p.prefName)
    : [];

  let text = `${typeTag} EEW 第${report.reportNumber}報${finalTag} (M${mag} / 検知: ${count}点)`;
  if (warnedNames.length > 0) {
    text += `\n対象地域: ${warnedNames.slice(0, 8).join('、')}${warnedNames.length > 8 ? ` 等 (${warnedNames.length}地域)` : ''}`;
  }
  return text;
}

/**
 * Determines the visual style of the banner based on the report type.
 */
export function getEEWBannerStyle(report: EEWReport): EEWBannerStyle {
  if (report.isWarning) {
    return {
      background: 'rgba(220, 38, 38, 0.6)',
      borderColor: 'rgba(255, 0, 0, 1)',
      boxShadow: '0 0 15px rgba(220, 38, 38, 0.8)',
    };
  }
  return {
    background: 'rgba(220, 38, 38, 0.3)',
    borderColor: 'rgba(220, 38, 38, 0.7)',
    boxShadow: 'none',
  };
}
