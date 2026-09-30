/**
 * src/components/ui/Legend.tsx
 * =============================
 * JMA Seismic Intensity scale color palette legend.
 */

import React from 'react';

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

export const Legend: React.FC = () => {
  return (
    <div className="glass-panel absolute bottom-6 left-6 z-40 p-3 rounded-xl text-white shadow-xl pointer-events-auto w-max">
      <div className="text-xs text-slate-400 font-medium mb-2">気象庁 震度階級</div>
      <div className="flex items-center space-x-1">
        {JMA_SCALES.map((item) => (
          <div key={item.scale} className="flex flex-col items-center">
            <div
              className="w-6 h-6 rounded flex items-center justify-center font-bold text-xs shadow-sm"
              style={{
                backgroundColor: item.color,
                color: item.scale === '4' ? '#111' : '#fff'
              }}
            >
              {item.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
