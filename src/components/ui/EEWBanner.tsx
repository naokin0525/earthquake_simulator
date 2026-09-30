/**
 * src/components/ui/EEWBanner.tsx
 * ===============================
 * JMA-styled flashing Emergency Earthquake Warning (EEW / 警報) alert banner.
 */

import React from 'react';
import { useSimulation } from '../../hooks/useSimulation';
import { AlertTriangle } from 'lucide-react';

export const EEWBanner: React.FC = () => {
  const { eewReport } = useSimulation();

  if (!eewReport || !eewReport.isWarning) {
    return null;
  }

  const est = eewReport.estimatedHypocenter;

  return (
    <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 w-11/12 max-w-2xl pointer-events-auto">
      <div className="eew-flash-banner glass-panel p-4 rounded-xl text-white flex items-center justify-between border-2 border-red-500 shadow-2xl">
        <div className="flex items-center space-x-3">
          <AlertTriangle className="w-8 h-8 text-yellow-300 animate-bounce flex-shrink-0" />
          <div>
            <div className="text-xl font-bold tracking-wider flex items-center space-x-2">
              <span>緊急地震速報 (警報)</span>
              <span className="text-xs bg-red-800 text-red-200 px-2 py-0.5 rounded font-mono">
                第 {eewReport.reportNumber} 報 {eewReport.isFinal ? '(最終報)' : ''}
              </span>
            </div>
            <div className="text-sm text-red-100 font-medium mt-0.5">
              推定震源: 北緯 {est.lat}° / 東経 {est.lon}° (深さ {est.depth}km, M{est.magnitude})
            </div>
          </div>
        </div>

        <div className="text-right flex-shrink-0 ml-4">
          <div className="text-xs text-red-200">最大予測震度</div>
          <div className="text-3xl font-black text-yellow-300 drop-shadow">
            {eewReport.maxPredictedIntensity}
          </div>
        </div>
      </div>
    </div>
  );
};
