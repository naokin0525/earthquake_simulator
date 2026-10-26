/**
 * src/components/ui/ControlPanel.tsx
 * ==================================
 * Floating control panel for simulation execution (Play, Pause, Reset, Speed, Depth, Mw, Quick jumps).
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
    isFaultVisible,
    toggleFaultVisible,
    isArvVisible,
    toggleArvVisible,
    play,
    pause,
    reset,
    setDepth,
    setMagnitude,
    setTimeScale,
    hasEpicenter,
    isMuted,
    isSpeechEnabled,
    isSpeechSupported,
    toggleMute,
    toggleSpeech,
    jumpToTime
  } = useSimulation();

  return (
    <div className="glass-panel controls" style={{ maxHeight: 'calc(100vh - 40px)', overflowY: 'auto' }}>
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
        <strong id="mag-val" className="text-swave">{hypocenter.magnitude.toFixed(2)}</strong>
      </div>
      <input
        type="range"
        id="mag"
        min="0.1"
        max="13.0"
        step="0.01"
        value={hypocenter.magnitude}
        onChange={(e) => setMagnitude(parseFloat(e.target.value))}
        className="w-full"
      />

      {/* Speed Multiplier */}
      <div style={{ marginTop: '10px', marginBottom: '6px' }}>
        <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>再生速度 (Speed):</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
          {[1, 2, 5, 10].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setTimeScale(s)}
              style={{
                background: timeScale === s ? 'rgba(0, 242, 254, 0.25)' : 'rgba(255,255,255,0.06)',
                border: `1px solid ${timeScale === s ? 'var(--accent-cyan)' : 'rgba(255,255,255,0.1)'}`,
                color: timeScale === s ? '#00f2fe' : '#cbd5e1',
                borderRadius: '4px',
                fontSize: '11px',
                padding: '4px 0',
                cursor: 'pointer',
                fontWeight: timeScale === s ? 'bold' : 'normal'
              }}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      {/* Quick Jump Buttons */}
      <div style={{ marginTop: '8px', marginBottom: '8px' }}>
        <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>情報発表時刻へジャンプ:</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: '10px', padding: '5px 2px' }}
            disabled={!hasEpicenter}
            onClick={() => jumpToTime(75)}
            title="震度速報の発表時刻 (T+75s) へジャンプ"
          >
            震度速報へ
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: '10px', padding: '5px 2px' }}
            disabled={!hasEpicenter}
            onClick={() => jumpToTime(180)}
            title="震源・震度情報の発表時刻 (T+180s) へジャンプ"
          >
            震源・震度へ
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: '10px', padding: '5px 2px' }}
            disabled={!hasEpicenter}
            onClick={() => jumpToTime(300)}
            title="長周期地震動観測情報の発表時刻 (T+300s) へジャンプ"
          >
            長周期情報へ
          </button>
        </div>
      </div>

      {/* Play / Pause */}
      <button id="play-btn" className="btn" onClick={isPlaying ? pause : play} disabled={!hasEpicenter}>
        {isPlaying ? '一時停止' : 'シミュレーション開始'}
      </button>

      {/* Reset */}
      <button id="reset-btn" className="btn btn-stop" onClick={reset} disabled={!hasEpicenter}>
        リセット
      </button>

      {/* Kyoshin Monitor Toggle */}
      <button id="kyoshin-btn" className="btn" onClick={toggleKyoshinMonitor}>
        {isKyoshinMonitor ? 'OFF' : '強震モニター'}
      </button>

      <div className="map-overlay-toggles" aria-label="地図レイヤー">
        <button
          id="fault-toggle"
          className="btn btn-secondary"
          type="button"
          onClick={toggleFaultVisible}
          aria-pressed={isFaultVisible}
        >
          断層表示: {isFaultVisible ? 'ON' : 'OFF'}
        </button>
        <button
          id="arv-toggle"
          className="btn btn-secondary"
          type="button"
          onClick={toggleArvVisible}
          aria-pressed={isArvVisible}
        >
          ARV表示: {isArvVisible ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className="control-toggles">
        <button
          id="audio-toggle"
          className="btn btn-secondary"
          type="button"
          onClick={toggleMute}
          aria-pressed={!isMuted}
        >
          警報音: {isMuted ? 'OFF' : 'ON'}
        </button>
        <button
          id="speech-toggle"
          className="btn btn-secondary"
          type="button"
          onClick={toggleSpeech}
          disabled={!isSpeechSupported}
          aria-pressed={isSpeechEnabled}
          title={isSpeechSupported ? '日本語音声でEEW警報を読み上げます' : 'このブラウザーは音声読み上げに対応していません'}
        >
          読み上げ: {isSpeechEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Epicenter required notice */}
      {!hasEpicenter && (
        <p className="mt-2 text-sm text-red-500">シミュレーション開始前にマップ上で震源を選択してください。</p>
      )}
    </div>
  );
};