/**
 * src/components/ui/Legend.tsx
 * =============================
 * Adaptive legend for Seismic Intensity, EEW alerts, and Long-Period Ground Motion.
 */

import React from 'react';
import { useSimulation } from '../../hooks/useSimulation';

export const Legend: React.FC = () => {
  const { mapDisplayMode, lpgmReport, earthquakeInfoReport, flashReport, eewReport } = useSimulation();

  let effectiveMode = mapDisplayMode;
  if (effectiveMode === 'auto') {
    if (lpgmReport && lpgmReport.affectedPrefectures.length > 0) {
      effectiveMode = 'lpgm';
    } else if (earthquakeInfoReport) {
      effectiveMode = 'detail';
    } else if (flashReport) {
      effectiveMode = 'flash';
    } else if (eewReport) {
      effectiveMode = 'eew';
    } else {
      effectiveMode = 'off';
    }
  }

  const JMA_SCALES = [
    { scale: '0', color: '#FFFFFF', label: '0' },
    { scale: '1', color: '#68C1F9', label: '1' },
    { scale: '2', color: '#C6F4CD', label: '2' },
    { scale: '3', color: '#FDEF72', label: '3' },
    { scale: '4', color: '#F6C344', label: '4' },
    { scale: '5-', color: '#E89939', label: '5弱' },
    { scale: '5+', color: '#DF742C', label: '5強' },
    { scale: '6-', color: '#EA4225', label: '6弱' },
    { scale: '6+', color: '#971E27', label: '6強' },
    { scale: '7', color: '#B825F7', label: '7' }
  ];

  const LPGM_SCALES = [
    { classLevel: 1, color: '#3b82f6', label: '階級1' },
    { classLevel: 2, color: '#f97316', label: '階級2' },
    { classLevel: 3, color: '#ef4444', label: '階級3' },
    { classLevel: 4, color: '#9333ea', label: '階級4' }
  ];

  return (
    <div className="glass-panel legend" id="legend-container" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      {effectiveMode === 'lpgm' ? (
        <>
          <span style={{ fontSize: '11px', marginRight: '6px', color: '#c4b5fd' }}>長周期階級</span>
          {LPGM_SCALES.map((item) => (
            <div
              key={item.classLevel}
              className="jma-box"
              style={{
                backgroundColor: item.color,
                color: '#fff',
                fontSize: '10px',
                padding: '2px 6px',
                minWidth: '36px',
                textAlign: 'center'
              }}
            >
              {item.label}
            </div>
          ))}
        </>
      ) : effectiveMode === 'eew' ? (
        <>
          <span style={{ fontSize: '11px', marginRight: '6px', color: '#cbd5e1' }}>EEW表示</span>
          <div
            className="jma-box"
            style={{
              backgroundColor: '#dc2626',
              color: '#fff',
              fontSize: '10px',
              padding: '2px 8px',
              border: '1px solid #fff'
            }}
          >
            警報 (震度4以上予想)
          </div>
          <div
            className="jma-box"
            style={{
              backgroundColor: '#ea9939',
              color: '#fff',
              fontSize: '10px',
              padding: '2px 8px'
            }}
          >
            予報 (震度3予想)
          </div>
        </>
      ) : (
        <>
          <span style={{ fontSize: '12px', marginRight: '6px', color: '#cbd5e1' }}>震度</span>
          {JMA_SCALES.map((item) => (
            <div
              key={item.scale}
              className="jma-box"
              style={{
                backgroundColor: item.color,
                color: item.scale === '4' ? '#111' : '#fff'
              }}
            >
              {item.label}
            </div>
          ))}
        </>
      )}
    </div>
  );
};
