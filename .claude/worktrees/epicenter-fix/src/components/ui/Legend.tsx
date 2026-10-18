/**
 * src/components/ui/Legend.tsx
 * =============================
 * JMA Seismic Intensity legend matching the vanilla HTML UI.
 */

import React from 'react';

export const Legend: React.FC = () => {
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

  return (
    <div className="glass-panel legend" id="legend-container">
      <span style={{ fontSize: '12px', marginRight: '6px', color: '#cbd5e1' }}>震度</span>
      {JMA_SCALES.map(item => (
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
    </div>
  );
};
