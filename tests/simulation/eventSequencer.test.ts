import { describe, expect, it, vi } from 'vitest';
import { EventSequencer, findContainingSubRegion } from '../../src/core/simulation/EventSequencer';
import { PREFECTURE_CENTROIDS } from '../../src/core/eew/EEWEngine';
import { estimateLPGM } from '../../src/core/physics/lpgm';
import { EEWReport, EarthquakeHypocenter, StationState, StationTriggerEvent } from '../../src/core/types';

const hypocenter: EarthquakeHypocenter = {
  lat: 35.5,
  lon: 139.5,
  depth: 20,
  magnitude: 6.8,
  originTime: 0
};

function estimatedReport(estimatedHypocenter = hypocenter): EEWReport {
  return {
    reportNumber: 1,
    isFinal: false,
    isWarning: false,
    estimatedHypocenter,
    originTime: estimatedHypocenter.originTime,
    triggeredStationCount: 1,
    maxPredictedIntensity: '0',
    warnedPrefectures: []
  };
}

function stationTrigger(
  stationIndex: number,
  state: StationState,
  intensity: StationTriggerEvent['intensity'],
  observedIntensity: StationTriggerEvent['intensity'] = intensity
): StationTriggerEvent {
  return {
    stationIndex,
    state,
    triggerTime: 10,
    pArrivalTime: 8,
    sArrivalTime: 10,
    pgvSurface: 1,
    intensity,
    continuousIntensity: 3,
    observedIntensity,
    observedPgv: 1
  };
}

describe('EventSequencer reports', () => {
  it('assigns observed station maxima to the containing sub-region, independently of prefecture maxima', async () => {
    const features = [
      {
        type: 'Feature',
        properties: { code: 'east', name: 'East area', pref: 13 },
        geometry: {
          type: 'Polygon',
          coordinates: [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]]
        }
      },
      {
        type: 'Feature',
        properties: { code: 'west', name: 'West area', pref: 13 },
        geometry: {
          type: 'Polygon',
          coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]
        }
      }
    ];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ features })
    } as Response);

    try {
      const sequencer = new EventSequencer();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const prefCodes = new Uint8Array([13, 13]);
      const triggers = [
        stationTrigger(0, StationState.S_ARRIVED, '5-'),
        stationTrigger(1, StationState.S_ARRIVED, '3')
      ];
      const locations = {
        lats: new Float32Array([0.5, 0.5]),
        lons: new Float32Array([1.5, 0.5])
      };

      sequencer.update(10, 2, null, hypocenter, triggers, prefCodes, locations.lats, locations.lons);
      const result = sequencer.update(90, 2, null, hypocenter, [], prefCodes, locations.lats, locations.lons);
      const report = result.event?.type === 'FLASH_REPORT' ? result.event.payload : undefined;

      expect(report?.prefectures).toEqual([
        { prefCode: 13, prefName: 'East area', maxIntensity: '5-' },
        { prefCode: 13, prefName: 'West area', maxIntensity: '3' }
      ]);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('issues a regional intensity report at 90 seconds for observed intensity 3+', () => {
    const sequencer = new EventSequencer();
    const prefCodes = new Uint8Array(51).fill(13);
    prefCodes.fill(14, 25, 50);
    const triggers = Array.from({ length: 50 }, (_, index) =>
      stationTrigger(index, StationState.S_ARRIVED, index < 25 ? '4' : '5-')
    );
    triggers.push(stationTrigger(50, StationState.P_TRIGGERED, '7', '0'));

    sequencer.update(12, 51, null, hypocenter, triggers, prefCodes);
    expect(sequencer.update(89, 51, null, hypocenter, [], prefCodes).event).toBeUndefined();
    const result = sequencer.update(90, 51, null, hypocenter, [], prefCodes);

    expect(result.event?.type).toBe('FLASH_REPORT');
    const report = result.event?.type === 'FLASH_REPORT' ? result.event.payload : undefined;
    expect(report).toMatchObject({
      issuedTime: 90,
      intensities: {
        '4': ['東京都'],
        '5-': ['神奈川県']
      }
    });
    expect(report?.summary).toContain('50');
    expect(report?.summary).toContain('2都道府県');
  });

  it('publishes flash reports at one-minute intervals, not when new observations arrive', () => {
    const sequencer = new EventSequencer();
    const prefCodes = new Uint8Array(2).fill(13);
    const initial = [
      stationTrigger(0, StationState.S_ARRIVED, '3'),
      stationTrigger(1, StationState.S_ARRIVED, '3')
    ];

    sequencer.update(90, 2, null, hypocenter, initial, prefCodes);
    const followUp = [
      stationTrigger(0, StationState.S_ARRIVED, '5-'),
      stationTrigger(1, StationState.S_ARRIVED, '5-')
    ];
    const earlyUpdate = sequencer.update(100, 2, null, hypocenter, followUp, prefCodes);
    const result = sequencer.update(150, 2, null, hypocenter, [], prefCodes);

    expect(earlyUpdate.event).toBeUndefined();
    expect(result.event?.type).toBe('FLASH_REPORT');
    expect(result.event?.type === 'FLASH_REPORT' ? result.event.payload.maxIntensity : null).toBe('5-');
  });

  it('caps the number of flash reports at six', () => {
    const sequencer = new EventSequencer();
    const prefCodes = new Uint8Array([13]);
    const trigger = [stationTrigger(0, StationState.S_ARRIVED, '3')];

    sequencer.update(10, 1, null, hypocenter, trigger, prefCodes);
    const reportTimes = [90, 150, 210, 270, 330, 390, 450].filter((time) =>
      sequencer.update(time, 1, null, hypocenter, [], prefCodes).event?.type === 'FLASH_REPORT'
    );

    expect(reportTimes).toEqual([90, 150, 210, 270, 330, 390]);
  });

  it('does not issue an intensity report when observed shaking is below intensity 3', () => {
    const sequencer = new EventSequencer();
    const prefCodes = new Uint8Array(50).fill(13);
    const triggers = Array.from({ length: 49 }, (_, index) =>
      stationTrigger(index, StationState.S_ARRIVED, '2')
    );
    triggers.push(stationTrigger(49, StationState.P_TRIGGERED, '5-', '2'));

    const lowMagnitudeHypocenter = { ...hypocenter, magnitude: 6.0 };
    const result = sequencer.update(90, 50, null, lowMagnitudeHypocenter, triggers, prefCodes);

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
    const prefCodes = new Uint8Array([1]);
    const observedIntensity = [stationTrigger(0, StationState.S_ARRIVED, '1')];
    const eewReport = estimatedReport(northernHypocenter);

    sequencer.update(11, 1, eewReport, northernHypocenter, [], prefCodes);
    sequencer.update(180, 1, eewReport, northernHypocenter, observedIntensity, prefCodes);
    sequencer.update(181, 1, eewReport, northernHypocenter, [], prefCodes);
    expect(sequencer.update(599, 1, eewReport, northernHypocenter, [], prefCodes).event).toBeUndefined();
    const result = sequencer.update(600, 1, eewReport, northernHypocenter, [], prefCodes);
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

    const estimate = { ...hypocenter, lat: 43.064, lon: 141.347, depth: 35, magnitude: 5.2 };
    const eewEstimate = estimatedReport(estimate);
    // Prime with arrival and the first sequential EEW estimate.
    sequencer.update(10, 1, eewEstimate, hypocenter, triggers, prefCodes);
    sequencer.update(11, 1, eewEstimate, hypocenter, [], prefCodes);

    // Flash report at ~90s
    const flashResult = sequencer.update(90, 1, eewEstimate, hypocenter, [], prefCodes);
    expect(flashResult.event?.type).toBe('FLASH_REPORT');

    // The next bulletin is scheduled for ~150s, not at every intermediate update.
    sequencer.update(150, 1, eewEstimate, hypocenter, [], prefCodes);

    // Earthquake info report at ~180s
    const result = sequencer.update(180, 1, eewEstimate, hypocenter, [], prefCodes);
    expect(result.event?.type).toBe('EARTHQUAKE_INFO');
    const report = result.event?.type === 'EARTHQUAKE_INFO' ? result.event.payload : undefined;
    expect(report).toBeDefined();
    expect(report?.issuedTime).toBe(180);
    expect(report?.epicenterName).toBeDefined();
    expect(report?.hypocenter).toEqual(estimate);
    expect(report?.maxIntensity).toBe('5-');
    expect(report?.prefectures.some((p) => p.prefName === '東京都')).toBe(true);
  });

  it('does not issue detailed earthquake information without intensity 1+ or an EEW warning', () => {
    const sequencer = new EventSequencer();
    const result = sequencer.update(180, 0, null, hypocenter, [], new Uint8Array());

    expect(result.event).toBeUndefined();
  });
});
