/**
 * src/components/ui/EEWHud.tsx
 * ============================
 * HUD overlay displaying active EEW report details, simulation clock, station trigger counts, and FPS counter.
 */

import React from 'react';
import { useSimulation } from '../../hooks/useSimulation';
import { Activity, Clock, Radio, ShieldAlert } from 'lucide-react';

export const EEWHud: React.FC = () => {
  const {
    simTime,
    pRadiusKm,
    sRadiusKm,
    eewReport,
    stationBuffer,
    stationStates,
    fps
  } = useSimulation();

  // Count active triggers
  let pCount = 0;
  let sCount = 0;
  for (let i = 0; i < stationStates.length; i++) {
    if (stationStates[i] === 1) pCount++;
    if (stationStates[i] === 2) sCount++;
  }

  const totalStations = stationBuffer ? stationBuffer.totalStations : 1749;

  return (
    <div className="glass-panel absolute top-6 left-6 z-40 p-4 rounded-2xl w-80 text-white space-y-3 shadow-2xl pointer-events-auto">
      {/* Header & FPS Counter */}
      <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
        <div className="flex items-center space-x-2 font-bold text-sm text-cyan-400 text-glow-cyan">
          <Activity className="w-4 h-4" />
          <span>ステータス HUD</span>
        </div>
        <div className="text-xs font-mono text-emerald-400 text-glow-emerald bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800 shadow-inner">
          {fps} FPS
        </div>
      </div>

      {/* Simulation Clock & Wave Radii */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-slate-800/40 p-2 rounded-lg border border-slate-700/50 space-y-0.5 shadow-inner">
          <div className="flex items-center space-x-1 text-slate-400">
            <Clock className="w-3.5 h-3.5" />
            <span>経過時間</span>
          </div>
          <div className="font-mono font-bold text-base text-cyan-300 text-glow-cyan">
            {simTime.toFixed(1)} s
          </div>
        </div>

        <div className="bg-slate-800/40 p-2 rounded-lg border border-slate-700/50 space-y-0.5 shadow-inner">
          <div className="flex items-center space-x-1 text-slate-400">
            <Radio className="w-3.5 h-3.5 text-rose-400" />
            <span>S波到達距離</span>
          </div>
          <div className="font-mono font-bold text-base text-rose-400 text-glow-rose">
            {sRadiusKm.toFixed(0)} km
          </div>
        </div>
      </div>

      {/* Station Trigger Summary */}
      <div className="space-y-1 text-xs">
        <div className="text-slate-400 font-medium">観測点検知状況 ({totalStations} 点):</div>
        <div className="grid grid-cols-3 gap-1 text-center font-mono font-semibold">
          <div className="bg-slate-800/40 py-1.5 rounded text-slate-400 shadow-inner">
            IDLE: {totalStations - pCount - sCount}
          </div>
          <div className="bg-amber-950/40 border border-amber-800/50 py-1.5 rounded text-amber-300 shadow-inner">
            P検知: {pCount}
          </div>
          <div className="bg-rose-950/40 border border-rose-800/50 py-1.5 rounded text-rose-300 shadow-inner">
            S到達: {sCount}
          </div>
        </div>
      </div>

      {/* Active EEW Report Inversion Box */}
      <div className="bg-slate-900/60 p-3.5 rounded-xl border border-slate-700/50 shadow-inner text-xs space-y-2 relative overflow-hidden">
        {/* Glow effect for the box */}
        <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-amber-500/50 to-transparent"></div>
        
        <div className="flex items-center justify-between font-bold text-amber-300 border-b border-slate-700/50 pb-1.5">
          <div className="flex items-center space-x-1 text-glow-amber">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            <span>EEW 逆解析推定情報</span>
          </div>
          {eewReport && (
            <span className="text-xs bg-amber-950 text-amber-300 px-1.5 py-0.5 rounded border border-amber-700">
              第 {eewReport.reportNumber} 報
            </span>
          )}
        </div>

        {eewReport ? (
          <div className="space-y-1 text-slate-200">
            <div className="flex justify-between">
              <span className="text-slate-400">推定震源:</span>
              <span className="font-mono font-semibold text-cyan-300">
                {eewReport.estimatedHypocenter.lat}°N / {eewReport.estimatedHypocenter.lon}°E
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">推定深さ / Mw:</span>
              <span className="font-mono font-semibold text-yellow-300">
                {eewReport.estimatedHypocenter.depth} km / M{eewReport.estimatedHypocenter.magnitude}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">検知観測点数:</span>
              <span className="font-mono font-semibold text-emerald-300">
                {eewReport.triggeredStationCount} 点
              </span>
            </div>
          </div>
        ) : (
          <div className="text-slate-500 italic text-center py-1">
            第一報待機中 (観測点検知待ち...)
          </div>
        )}
      </div>
    </div>
  );
};
