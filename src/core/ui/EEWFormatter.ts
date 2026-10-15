/**
 * src/core/ui/EEWFormatter.ts
 * =========================
 * Formatting logic for Earthquake Early Warning (EEW) banners.
 */
import { EEWReport } from '../types';

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
