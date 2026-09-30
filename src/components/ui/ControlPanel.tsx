/**
 * src/components/ui/ControlPanel.tsx
 * ==================================
 * Floating control panel for simulation execution (Play, Pause, Reset, Speed, Depth, Mw, Mesh overlay).
 */

import React from 'react';
import { useSimulation } from '../../hooks/useSimulation';
import { Play, Pause, RotateCcw, Layers, Sliders } from 'lucide-react';

export const ControlPanel: React.FC = () => {
  const {
    isPlaying,
    timeScale,
    hypocenter,
    isMeshVisible,
    play,
    pause,
    reset,
    setDepth,
    setMagnitude,
    setTimeScale,
    toggleMeshVisible
  } = useSimulation();

  return (
    <div className="glass-panel absolute bottom-6 right-6 z-40 p-5 rounded-2xl w-72 text-white space-y-4 shadow-2xl pointer-events-auto">
      <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
        <div className="flex items-center space-x-2 font-bold text-base text-cyan-400 text-glow-cyan">
          <Sliders className="w-5 h-5" />
          <span>シミュレーション制御</span>
        </div>
        <button
          onClick={toggleMeshVisible}
          className={`flex items-center space-x-1 text-xs px-2.5 py-1.5 rounded-lg border transition-all ${isMeshVisible
              ? 'bg-cyan-600/80 border-cyan-400 text-white shadow-lg'
              : 'bg-slate-800/60 border-slate-600 text-slate-300 hover:bg-slate-700'
            }`}
          title="推計震度分布図 (250mメッシュ) の表示切り替え"
        >
          <Layers className="w-3.5 h-3.5" />
          <span>推計震度</span>
        </button>
      </div>

      {/* Play / Pause / Reset Buttons */}
      <div className="flex items-center justify-between space-x-2">
        {!isPlaying ? (
          <button
            onClick={play}
            className="premium-btn flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white py-2.5 px-4 rounded-xl font-semibold flex items-center justify-center space-x-2 shadow-lg shadow-cyan-500/20 transition-all"
          >
            <Play className="w-5 h-5 fill-current" />
            <span>再生</span>
          </button>
        ) : (
          <button
            onClick={pause}
            className="premium-btn flex-1 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white py-2.5 px-4 rounded-xl font-semibold flex items-center justify-center space-x-2 shadow-lg shadow-orange-500/20 transition-all"
          >
            <Pause className="w-5 h-5 fill-current" />
            <span>一時停止</span>
          </button>
        )}

        <button
          onClick={reset}
          className="premium-btn bg-slate-800/80 hover:bg-slate-700 text-slate-300 p-2.5 rounded-xl border border-slate-600 shadow-md hover:shadow-slate-500/20 transition-all"
          title="リセット"
        >
          <RotateCcw className="w-5 h-5" />
        </button>
      </div>

      {/* Speed Multiplier (1x, 2x, 5x, 10x) */}
      <div className="space-y-1.5">
        <label className="text-xs text-slate-400 font-medium">再生速度:</label>
        <div className="grid grid-cols-4 gap-1.5">
          {[1, 2, 5, 10].map((speed) => (
            <button
              key={speed}
              onClick={() => setTimeScale(speed)}
              className={`py-1 text-xs font-semibold rounded-lg transition-all ${timeScale === speed
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow'
                  : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700'
                }`}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>

      {/* Earthquake Depth Slider */}
      <div className="space-y-1.5 pt-2 border-t border-slate-700/60">
        <div className="flex justify-between text-xs">
          <span className="text-slate-400 font-medium">震源の深さ (Depth):</span>
          <span className="font-semibold text-cyan-300 text-glow-cyan">{hypocenter.depth} km</span>
        </div>
        <input
          type="range"
          min="0"
          max="700"
          step="5"
          value={hypocenter.depth}
          onChange={(e) => setDepth(parseFloat(e.target.value))}
          className="w-full accent-cyan-400 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
        />
      </div>

      {/* Earthquake Magnitude Slider */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-slate-400 font-medium">マグニチュード (Mw):</span>
          <span className="font-semibold text-rose-400 text-glow-rose">M {hypocenter.magnitude.toFixed(1)}</span>
        </div>
        <input
          type="range"
          min="2.0"
          max="13.0"
          step="0.1"
          value={hypocenter.magnitude}
          onChange={(e) => setMagnitude(parseFloat(e.target.value))}
          className="w-full accent-rose-500 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
        />
      </div>
    </div>
  );
};
