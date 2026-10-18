export interface EEWReport {
  reportNumber: number;
  type: 'FORECAST' | 'WARNING';
  isWarning: boolean;
  isFinal: boolean;
  estimatedHypocenter: {
    magnitude: number;
    depth: number;
  };
  triggeredStationCount: number;
  warnedPrefectures: Array<{
    prefCode: string;
    prefName: string;
    isWarning: boolean;
  }>;
}

export function formatEEWBannerText(report: EEWReport): string {
  const mag = report.estimatedHypocenter.magnitude.toFixed(1);
  const count = report.triggeredStationCount;
  const finalTag = report.isFinal ? ' [最終報]' : '';
  const typeTag = report.type === 'WARNING' || report.isWarning ? '【警報】' : '【予報】';

  const warnedNames = report.warnedPrefectures
    ? report.warnedPrefectures.filter(p => p.isWarning).map(p => p.prefName)
    : [];

  let text = `${typeTag} EEW 第${report.reportNumber}報${finalTag} (M${mag} / 検知: ${count}点)`;
  if (warnedNames.length > 0) {
    text += `\n対象地域: ${warnedNames.slice(0, 8).join('、')}${warnedNames.length > 8 ? ` 等 (${warnedNames.length}地域)` : ''}`;
  }
  return text;
}
