/**
 * src/components/ui/EEWHud.tsx
 * ===========================
 * HUD panel matching the vanilla.html layout.
 */

import React from 'react';
import { useSimulation } from '../../hooks/useSimulation';
import { StationState } from '../../core/types';

export const EEWHud: React.FC = () => {
  const {
    simTime,
    eewReport,
    stationStates,
    isKyoshinMonitor,
  } = useSimulation();

  // Count P‑wave and S‑wave detections based on state enum values.
  let pCount = 0;
  let sCount = 0;
  for (let i = 0; i < stationStates.length; i++) {
    if (stationStates[i] === StationState.P_TRIGGERED) pCount++;
    else if (stationStates[i] === StationState.S_ARRIVED) sCount++;
  }

  return (
    <div className="glass-panel hud">
      <h3 style={{ marginTop: 0, marginBottom: '6px', color: 'var(--accent-cyan)' }}>
        Earthquake Simulator
      </h3>
      <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: 0, marginBottom: '14px' }}>
        地図上をクリックして震源地を設定してください
      </p>

      <div className="flex-between">
        <span style={{ color: '#cbd5e1' }}>経過時間 (Elapsed)</span>
        <strong id="sim-time" className="text-cyan">
          {simTime.toFixed(1)} s
        </strong>
      </div>
      <div className="flex-between">
        <span style={{ color: '#cbd5e1' }}>P波検知地点 (P-Wave)</span>
        <strong id="p-count" className="text-pwave">
          {pCount}
        </strong>
      </div>
      <div className="flex-between">
        <span style={{ color: '#cbd5e1' }}>主要動到達地点 (S-Wave)</span>
        <strong id="s-count" className="text-swave">
          {sCount}
        </strong>
      </div>
      <hr style={{ borderColor: 'rgba(255,255,255,0.1)', margin: '12px 0' }} />

      {/* EEW banner inline, re‑using the same logic as EEWBanner component */}
      {eewReport && (
        <div
          id="eew-banner"
          className="glass-panel"
          style={{
            display: 'block',
            color: '#fff',
            fontWeight: 'bold',
            background: eewReport.isWarning ? 'rgba(220, 38, 38, 0.6)' : 'rgba(220, 38, 38, 0.3)',
            padding: '8px',
            borderRadius: '8px',
            border: `1px solid ${eewReport.isWarning ? 'rgba(255, 0, 0, 1)' : 'rgba(220, 38, 38, 0.7)'}`,
            textAlign: 'center',
            fontSize: '13px',
            boxShadow: eewReport.isWarning ? '0 0 15px rgba(220, 38, 38, 0.8)' : 'none',
          }}
        >
          {eewReport.isWarning ? '警報' : '予報'} EEW 第{eewReport.reportNumber}報{eewReport.isFinal ? ' [最終報]' : ''}
          <br />
          推定震源: 北緯 {eewReport.estimatedHypocenter.lat}° / 東経 {eewReport.estimatedHypocenter.lon}° (深さ {eewReport.estimatedHypocenter.depth}km, M{eewReport.estimatedHypocenter.magnitude})
        </div>
      )}
    </div>
  );
};
