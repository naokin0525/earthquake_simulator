import { describe, expect, it } from 'vitest';
import { EventSequencer } from '../../src/core/simulation/EventSequencer';
import { PREFECTURE_CENTROIDS } from '../../src/core/eew/EEWEngine';
import { estimateLPGM } from '../../src/core/physics/lpgm';
import { EarthquakeHypocenter, StationState, StationTriggerEvent } from '../../src/core/types';

const hypocenter: EarthquakeHypocenter = {
  lat: 35.5,
  lon: 139.5,
  depth: 20,
  magnitude: 6.8,
  originTime: 0
};

function stationTrigger(
  stationIndex: number,
  state: StationState,
  intensity: StationTriggerEvent['intensity']
): StationTriggerEvent {
  return {
    stationIndex,
    state,
    triggerTime: 10,
    pArrivalTime: 8,
    sArrivalTime: 10,
    pgvSurface: 1,
    intensity,
    continuousIntensity: 3
  };
}

describe('EventSequencer reports', () => {
  it('builds a regional intensity report from at least 50 distinct S-wave arrivals', () => {
    const sequencer = new EventSequencer();
    const prefCodes = new Uint8Array(51).fill(13);
    prefCodes.fill(14, 25, 50);
    const triggers = Array.from({ length: 50 }, (_, index) =>
      stationTrigger(index, StationState.S_ARRIVED, index < 25 ? '4' : '5-')
    );
    triggers.push(stationTrigger(50, StationState.P_TRIGGERED, '7'));

    const result = sequencer.update(12, 51, null, hypocenter, triggers, prefCodes);

    expect(result.event?.type).toBe('FLASH_REPORT');
    const report = result.event?.type === 'FLASH_REPORT' ? result.event.payload : undefined;
    expect(report).toMatchObject({
      issuedTime: 12,
      intensities: {
        '4': ['東京都'],
        '5-': ['神奈川県']
      }
    });
    expect(report?.summary).toContain('50');
    expect(report?.summary).toContain('2都道府県');
  });

  it('does not issue an intensity report for P-wave triggers or fewer than 50 S arrivals', () => {
    const sequencer = new EventSequencer();
    const prefCodes = new Uint8Array(50).fill(13);
    const triggers = Array.from({ length: 49 }, (_, index) =>
      stationTrigger(index, StationState.S_ARRIVED, '3')
    );
    triggers.push(stationTrigger(49, StationState.P_TRIGGERED, '5-'));

    const lowMagnitudeHypocenter = { ...hypocenter, magnitude: 6.0 };
    const result = sequencer.update(12, 50, null, lowMagnitudeHypocenter, triggers, prefCodes);

    expect(result.event).toBeUndefined();
    expect(result.milestone).toBeUndefined();
  });

  it('reports only prefectures with a non-zero estimated long-period class', () => {
    const sequencer = new EventSequencer();
    const northernHypocenter: EarthquakeHypocenter = {
      ...hypocenter,
      lat: 43.064,
      lon: 141.347,
      depth: 10,
      magnitude: 9
    };

    sequencer.update(180, 0, null, northernHypocenter, [], new Uint8Array());
    const result = sequencer.update(300, 0, null, northernHypocenter, [], new Uint8Array());
    const report = result.event?.type === 'LPGM_REPORT' ? result.event.payload : undefined;
    const affectedPrefectures = report?.affectedPrefectures ?? [];
    const expected = Object.entries(PREFECTURE_CENTROIDS)
      .map(([code, prefecture]) => ({
        prefCode: Number(code),
        prefName: prefecture.name,
        classLevel: estimateLPGM(
          northernHypocenter,
          prefecture.lat,
          prefecture.lon,
          prefecture.defaultArv
        ).classLevel
      }))
      .filter((prefecture) => prefecture.classLevel > 0);

    expect(result.event?.type).toBe('LPGM_REPORT');
    expect(affectedPrefectures).toEqual(expected);
    expect(affectedPrefectures.some((prefecture) => prefecture.prefName === '北海道')).toBe(true);
    expect(affectedPrefectures.some((prefecture) => prefecture.prefName === '東京都')).toBe(false);
  });

  it('issues detailed EARTHQUAKE_INFO report at simTime >= 180s', () => {
    const sequencer = new EventSequencer();
    const prefCodes = new Uint8Array(1).fill(13); // Tokyo
    const triggers = [stationTrigger(0, StationState.S_ARRIVED, '5-')];

    // Prime with arrival
    sequencer.update(10, 1, null, hypocenter, triggers, prefCodes);

    // Flash report at ~70s
    const flashResult = sequencer.update(75, 1, null, hypocenter, [], prefCodes);
    expect(flashResult.event?.type).toBe('FLASH_REPORT');

    // Earthquake info report at ~180s
    const result = sequencer.update(180, 1, null, hypocenter, [], prefCodes);
    expect(result.event?.type).toBe('EARTHQUAKE_INFO');
    const report = result.event?.type === 'EARTHQUAKE_INFO' ? result.event.payload : undefined;
    expect(report).toBeDefined();
    expect(report?.issuedTime).toBe(180);
    expect(report?.epicenterName).toBeDefined();
    expect(report?.maxIntensity).toBe('5-');
    expect(report?.prefectures.some((p) => p.prefName === '東京都')).toBe(true);
  });
});
