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
    lpgmReport,
  } = useSimulation();

  // Count P‑wave detections and S‑wave arrivals.
  let pCount = 0;
  let sCount = 0;
  for (let i = 0; i < stationStates.length; i++) {
    const st = stationStates[i];
    if (st === StationState.P_TRIGGERED) pCount++;
    else if (st === StationState.S_ARRIVED) sCount++;
  }

  // Determine which steps are currently active.
  const stepsActive = [
    isPlaying, // 0: Origin (simulation running)
    pCount > 0, // 1: P‑wave detection
    !!eewReport && eewReport.reportNumber >= 1, // 2: EEW forecast (first report)
    !!eewReport && eewReport.isWarning, // 3: EEW warning issued
    sCount > 0, // 4: S‑wave arrival
    !!flashReport, // 5: Intensity flash report
    !!eewReport && eewReport.isFinal && eewReport.estimatedHypocenter.magnitude >= 7.0, // 6: Final report (M≥7.0)
    !!lpgmReport, // 7: Long‑Period Ground Motion (estimated intensity map)
  ];

  // Find the latest active step index – used for styling.
  let currentActiveIdx = -1;
  stepsActive.forEach((active, i) => {
    if (active) currentActiveIdx = i;
  });

  const labels = [
    '1. 地震発生',
    '2. 揺れの検知 (P波検知)',
    '3. 緊急地震速報 (予報): M3.5以上、または推定最大震度3以上などで発行',
    '4. 緊急地震速報 (警報): 2点以上の観測点検知かつ最大震度5弱以上などで発行',
    '5. 主要動到達 (S波検知)',
    '6. 震度速報',
    '7. 地震情報 (M7.0以上で長周期地震動情報を含む)',
    '8. 推定震度分布図',
  ];

  return (
    <div className="glass-panel timeline-panel">
      <h3
        className="mb-3 text-sm font-bold"
        style={{ color: 'var(--accent-cyan)', marginTop: 0, marginBottom: '12px' }}
      >
        JMA Event Flow
      </h3>
      <div id="jma-timeline">
        {stepsActive.map((_, idx) => {
          const isCompleted = idx < currentActiveIdx;
          const isCurrent = idx === currentActiveIdx;
          const className = [
            'timeline-step',
            isCompleted ? 'completed' : '',
            isCurrent ? 'active' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div key={`step-${idx}`} id={`step-${idx}`} className={className}>
              <div className="step-dot"></div>
              <span>{labels[idx]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
