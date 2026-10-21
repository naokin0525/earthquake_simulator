import { describe, expect, it } from 'vitest';
import { formatEewWarningAnnouncement } from '../../src/core/ui/EEWFormatter';
import { EEWReport } from '../../src/core/types';

const report: EEWReport = {
  reportNumber: 2,
  isFinal: false,
  isWarning: true,
  estimatedHypocenter: {
    lat: 35.5,
    lon: 139.5,
    depth: 20,
    magnitude: 6.8,
    originTime: 0
  },
  originTime: 0,
  triggeredStationCount: 8,
  maxPredictedIntensity: '5-',
  warnedPrefectures: [
    { prefCode: 13, prefName: '東京都', maxPredictedIntensity: '5-', isWarning: true },
    { prefCode: 14, prefName: '神奈川県', maxPredictedIntensity: '4', isWarning: false }
  ]
};

describe('formatEewWarningAnnouncement', () => {
  it('summarizes the warning level, station count, and only warning target prefectures', () => {
    expect(formatEewWarningAnnouncement(report)).toBe(
      '緊急地震速報、警報です。最大予想震度は5弱、検知した観測点は8地点です。警報対象地域は東京都です。'
    );
  });

  it('omits target regions when no prefecture meets the warning criteria', () => {
    expect(formatEewWarningAnnouncement({
      ...report,
      warnedPrefectures: report.warnedPrefectures.map((prefecture) => ({
        ...prefecture,
        isWarning: false
      }))
    })).not.toContain('警報対象地域');
  });
});
