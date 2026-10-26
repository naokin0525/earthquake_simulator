/**
 * src/components/ui/Legend.tsx
 * =============================
 * Adaptive legend for Seismic Intensity, EEW alerts, and Long-Period Ground Motion.
 */

import React from 'react';
import { useSimulation } from '../../hooks/useSimulation';
import { JMA_INTENSITY_LEVELS, LPGM_INTENSITY_LEVELS } from '../../core/ui/intensityColors';

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

  return (
    <div className="glass-panel legend" id="legend-container" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      {effectiveMode === 'lpgm' ? (
        <>
          <span style={{ fontSize: '11px', marginRight: '6px', color: '#c4b5fd' }}>長周期階級</span>
          {LPGM_INTENSITY_LEVELS.map((item) => (
            <div
              key={item.classLevel}
              className="jma-box"
              style={{
                backgroundColor: item.colour,
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
          {JMA_INTENSITY_LEVELS.map((item) => (
            <div
              key={item.scale}
              className="jma-box"
              style={{
                backgroundColor: item.colour,
                color: item.scale === '0' || item.scale === '2' || item.scale === '3' || item.scale === '4'
                  ? '#111'
                  : '#fff'
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
