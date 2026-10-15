/**
 * src/components/ui/ControlPanel.tsx
 * ==================================
 * Floating control panel for simulation execution (Play, Pause, Reset, Speed, Depth, Mw, Mesh overlay).
 */

import React from 'react';
import { useSimulation } from '../../hooks/useSimulation';

export const ControlPanel: React.FC = () => {
  const {
    isPlaying,
    timeScale,
    hypocenter,
    isKyoshinMonitor,
    toggleKyoshinMonitor,
    play,
    pause,
    reset,
    setDepth,
    setMagnitude,
    setTimeScale,
  } = useSimulation();

  return (
    <div className="glass-panel controls">
      {/* Depth Slider */}
      <div className="flex-between">
        <span>震源の深さ</span>
        <strong id="depth-val" className="text-cyan">{hypocenter.depth} km</strong>
      </div>
      <input
        type="range"
        id="depth"
        min="0"
        max="800"
        step="1"
        value={hypocenter.depth}
        onChange={(e) => setDepth(parseFloat(e.target.value))}
        className="w-full"
      />

      {/* Magnitude Slider */}
      <div className="flex-between mt-2">
        <span>マグニチュード</span>
        <strong id="mag-val" className="text-swave">{hypocenter.magnitude.toFixed(1)}</strong>
      </div>
      <input
        type="range"
        id="mag"
        min="0.1"
        max="13.0"
        step="0.1"
        value={hypocenter.magnitude}
        onChange={(e) => setMagnitude(parseFloat(e.target.value))}
        className="w-full"
      />

      {/* Play / Pause */}
      <button id="play-btn" className="btn" onClick={isPlaying ? pause : play}>
        {isPlaying ? '一時停止' : 'シミュレーション開始'}
      </button>

      {/* Reset */}
      <button id="reset-btn" className="btn btn-stop" onClick={reset}>
        リセット
      </button>

      {/* Kyoshin Monitor Toggle */}
      <button id="kyoshin-btn" className="btn" onClick={toggleKyoshinMonitor}>
        {isKyoshinMonitor ? 'OFF' : '強震モニター'}
      </button>
    </div>
  );
};