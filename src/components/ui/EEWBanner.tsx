/**
 * src/components/ui/EEWBanner.tsx
 * ===============================
 * JMA-styled flashing Emergency Earthquake Warning (EEW / 警報) alert banner.
 */

import React from 'react';
import { useSimulation } from '../../hooks/useSimulation';

export const EEWBanner: React.FC = () => {
  const { eewReport } = useSimulation();

  if (!eewReport) {
    return null;
  }

  const est = eewReport.estimatedHypocenter;
  const typeTag = eewReport.isWarning ? '警報' : '予報';
  const finalTag = eewReport.isFinal ? ' [最終報]' : '';

  // Determine background based on warning type (same logic as original JS)
  const bg = eewReport.type === 'WARNING' ? 'rgba(220, 38, 38, 0.6)' : 'rgba(220, 38, 38, 0.3)';
  const border = eewReport.type === 'WARNING' ? 'rgba(255, 0, 0, 1)' : 'rgba(220, 38, 38, 0.7)';
  const shadow = eewReport.type === 'WARNING' ? '0 0 15px rgba(220, 38, 38, 0.8)' : 'none';

  return (
    <div
      id="eew-banner"
      className="glass-panel"
      style={{
        display: 'block',
        color: '#fff',
        fontWeight: 'bold',
        background: bg,
        padding: '8px',
        borderRadius: '8px',
        border: `1px solid ${border}`,
        textAlign: 'center',
        fontSize: '13px',
        boxShadow: shadow,
      }}
    >
      {typeTag} EEW 第{eewReport.reportNumber}報{finalTag}<br />
      推定震源: 北緯 {est.lat}° / 東経 {est.lon}° (深さ {est.depth}km, M{est.magnitude})
    </div>
  );
};