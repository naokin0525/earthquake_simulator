import React from 'react';
import { useSimulation } from '../../hooks/useSimulation';
import { StationState } from '../../core/types';

/**
 * Timeline component visualising JMA event flow.
 * Mirrors the original HTML timeline panel and updates step states
 * based on the simulation context.
 */
export const JmaTimeline: React.FC = () => {
  const {
    isPlaying,
    stationStates,
    eewReport,
    flashReport,
    earthquakeInfoReport,
    lpgmReport,
    mapDisplayMode,
    setMapDisplayMode
  } = useSimulation();

  // Count P-wave detections and S-wave arrivals.
  let pCount = 0;
  let sCount = 0;
  for (let i = 0; i < stationStates.length; i++) {
    const st = stationStates[i];
    if (st === StationState.P_TRIGGERED) pCount++;
    else if (st === StationState.S_ARRIVED) sCount++;
  }

  // Determine which steps are currently active.
  const stepsActive = [
    isPlaying, // 0: Origin
    pCount > 0, // 1: P-wave detection
    !!eewReport && eewReport.reportNumber >= 1, // 2: EEW forecast
    !!eewReport && eewReport.isWarning, // 3: EEW warning
    sCount > 0, // 4: S-wave arrival
    !!flashReport, // 5: Intensity flash report (approx. 1-2 min)
    !!earthquakeInfoReport, // 6: Detailed earthquake info (approx. 3-5 min)
    !!lpgmReport, // 7: Long-period ground motion (approx. 10 min)
  ];

  // Find the latest active step index – used for styling.
  let currentActiveIdx = -1;
  stepsActive.forEach((active, i) => {
    if (active) currentActiveIdx = i;
  });

  const stepMeta: { label: string; mode?: 'eew' | 'flash' | 'detail' | 'lpgm' }[] = [
    { label: '1. 地震発生 (T+0s)' },
    { label: '2. 揺れの検知 (P波初検知)' },
    { label: '3. 緊急地震速報 (予報) [数秒〜]', mode: 'eew' },
    { label: '4. 緊急地震速報 (警報) [数秒〜]', mode: 'eew' },
    { label: '5. 主要動到達 (S波到達)' },
    { label: '6. 震度速報 [約1~2分後]', mode: 'flash' },
    { label: '7. 震源・震度情報 [約3~5分後]', mode: 'detail' },
    { label: '8. 長周期地震動観測情報 [約10分後]', mode: 'lpgm' },
  ];

  return (
    <div className="glass-panel timeline-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h3
          className="text-sm font-bold"
          style={{ color: 'var(--accent-cyan)', margin: 0 }}
        >
          JMA Event Flow
        </h3>
        <button
          type="button"
          onClick={() => setMapDisplayMode('auto')}
          style={{
            background: mapDisplayMode === 'auto' ? 'rgba(0, 242, 254, 0.25)' : 'rgba(255,255,255,0.08)',
            border: `1px solid ${mapDisplayMode === 'auto' ? 'var(--accent-cyan)' : 'rgba(255,255,255,0.2)'}`,
            color: mapDisplayMode === 'auto' ? '#00f2fe' : '#94a3b8',
            borderRadius: '6px',
            fontSize: '11px',
            padding: '2px 8px',
            cursor: 'pointer'
          }}
          title="最新の発表情報に応じて地図色を自動切り替え"
        >
          自動
        </button>
      </div>

      <div id="jma-timeline">
        {stepsActive.map((_, idx) => {
          const isCompleted = idx < currentActiveIdx;
          const isCurrent = idx === currentActiveIdx;
          const meta = stepMeta[idx];
          const isSelectedMode = meta.mode && mapDisplayMode === meta.mode;

          const className = [
            'timeline-step',
            isCompleted ? 'completed' : '',
            isCurrent ? 'active' : '',
            isSelectedMode ? 'selected-mode' : '',
            meta.mode && stepsActive[idx] ? 'cursor-pointer hover:opacity-80' : ''
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <div
              key={`step-${idx}`}
              id={`step-${idx}`}
              className={className}
              style={{
                cursor: meta.mode && stepsActive[idx] ? 'pointer' : 'default',
                padding: '4px 6px',
                borderRadius: '6px',
                background: isSelectedMode ? 'rgba(0, 242, 254, 0.15)' : 'transparent'
              }}
              onClick={() => {
                if (meta.mode && stepsActive[idx]) {
                  setMapDisplayMode(meta.mode);
                }
              }}
              title={meta.mode && stepsActive[idx] ? `クリックして地図を「${meta.label}」表示に切り替え` : undefined}
            >
              <div className="step-dot" style={{
                background: isSelectedMode ? '#00f2fe' : undefined,
                boxShadow: isSelectedMode ? '0 0 8px #00f2fe' : undefined
              }}></div>
              <span style={{ fontSize: '12px' }}>{meta.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
