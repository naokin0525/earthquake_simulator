/**
 * src/components/ui/EEWHud.tsx
 * ===========================
 * Comprehensive HUD panel for JMA bulletin sequence and simulation statistics.
 */

import React from 'react';
import { useSimulation } from '../../hooks/useSimulation';
import { JmaIntensityScale, StationState } from '../../core/types';

const INTENSITY_ORDER: JmaIntensityScale[] = ['7', '6+', '6-', '5+', '5-', '4', '3', '2', '1', '0'];
const INTENSITY_LABELS: Record<JmaIntensityScale, string> = {
  '0': '0',
  '1': '1',
  '2': '2',
  '3': '3',
  '4': '4',
  '5-': '5弱',
  '5+': '5強',
  '6-': '6弱',
  '6+': '6強',
  '7': '7'
};

export const EEWHud: React.FC = () => {
  const {
    simTime,
    eewReport,
    flashReport,
    earthquakeInfoReport,
    lpgmReport,
    stationStates,
    mapDisplayMode,
    setMapDisplayMode
  } = useSimulation();

  let pCount = 0;
  let sCount = 0;
  for (let i = 0; i < stationStates.length; i++) {
    const st = stationStates[i];
    if (st === StationState.P_TRIGGERED) pCount++;
    else if (st === StationState.S_ARRIVED) sCount++;
  }

  return (
    <div className="glass-panel hud" style={{ maxHeight: 'calc(100vh - 40px)', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <h3 style={{ margin: 0, color: 'var(--accent-cyan)', fontSize: '15px' }}>
          Earthquake Simulator
        </h3>
        <span style={{ fontSize: '11px', color: '#94a3b8' }}>JMA Standard</span>
      </div>

      <p style={{ fontSize: '11px', color: '#94a3b8', marginTop: 0, marginBottom: '10px' }}>
        地図上をクリックして震源地を設定してください
      </p>

      {/* Map Display Mode Selector */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>地図表示モード:</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
          {[
            { id: 'auto', label: '自動連動' },
            { id: 'eew', label: 'EEW (警報/予報)' },
            { id: 'flash', label: '震度速報' },
            { id: 'detail', label: '各地の震度' },
            { id: 'lpgm', label: '長周期地震動' },
            { id: 'off', label: '通常地図' },
          ].map((mode) => {
            const isSelected = mapDisplayMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => setMapDisplayMode(mode.id as any)}
                style={{
                  background: isSelected ? 'rgba(0, 242, 254, 0.25)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${isSelected ? 'var(--accent-cyan)' : 'rgba(255,255,255,0.1)'}`,
                  color: isSelected ? '#00f2fe' : '#cbd5e1',
                  borderRadius: '4px',
                  fontSize: '10px',
                  padding: '4px 2px',
                  cursor: 'pointer',
                  fontWeight: isSelected ? 'bold' : 'normal'
                }}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-between">
        <span style={{ color: '#cbd5e1', fontSize: '12px' }}>経過時間 (Elapsed)</span>
        <strong id="sim-time" className="text-cyan">
          {simTime.toFixed(1)} s
        </strong>
      </div>
      <div className="flex-between">
        <span style={{ color: '#cbd5e1', fontSize: '12px' }}>P波検知地点 (P-Wave)</span>
        <strong id="p-count" className="text-pwave">
          {pCount}
        </strong>
      </div>
      <div className="flex-between">
        <span style={{ color: '#cbd5e1', fontSize: '12px' }}>主要動到達地点 (S-Wave)</span>
        <strong id="s-count" className="text-swave">
          {sCount}
        </strong>
      </div>
      <hr style={{ borderColor: 'rgba(255,255,255,0.1)', margin: '10px 0' }} />

      {/* EEW Banner */}
      {eewReport && (
        <div
          id="eew-banner"
          className="glass-panel"
          style={{
            display: 'block',
            color: '#fff',
            fontWeight: 'bold',
            background: eewReport.isWarning
              ? 'linear-gradient(135deg, rgba(220, 38, 38, 0.8), rgba(185, 28, 28, 0.6))'
              : 'linear-gradient(135deg, rgba(217, 119, 6, 0.7), rgba(180, 83, 9, 0.5))',
            padding: '10px',
            borderRadius: '8px',
            border: `1px solid ${eewReport.isWarning ? '#ef4444' : '#f59e0b'}`,
            textAlign: 'center',
            fontSize: '12px',
            boxShadow: eewReport.isWarning ? '0 0 15px rgba(239, 68, 68, 0.6)' : 'none',
            marginBottom: '8px'
          }}
        >
          <div style={{ fontSize: '14px', marginBottom: '4px' }}>
            {eewReport.isWarning ? '【緊急地震速報 (警報)】' : '【緊急地震速報 (予報)】'} 第{eewReport.reportNumber}報{eewReport.isFinal ? ' [最終報]' : ''}
          </div>
          <div>
            推定震源: 北緯 {eewReport.estimatedHypocenter.lat.toFixed(2)}° / 東経 {eewReport.estimatedHypocenter.lon.toFixed(2)}°
            (深さ {Math.round(eewReport.estimatedHypocenter.depth)}km, M{eewReport.estimatedHypocenter.magnitude.toFixed(1)})
          </div>
          <div style={{ marginTop: '2px', color: '#fef08a' }}>
            最大予想震度: {INTENSITY_LABELS[eewReport.maxPredictedIntensity]} / 検知: {eewReport.triggeredStationCount}地点
          </div>
          {eewReport.isWarning && eewReport.warnedPrefectures.some((p) => p.isWarning) && (
            <div style={{ marginTop: '4px', fontSize: '11px', textAlign: 'left', background: 'rgba(0,0,0,0.3)', padding: '4px 6px', borderRadius: '4px' }}>
              <span style={{ color: '#fca5a5', fontWeight: 'bold' }}>警報対象地域 (震度4以上予想):</span>
              <br />
              {eewReport.warnedPrefectures
                .filter((p) => p.isWarning)
                .map((p) => p.prefName)
                .join('、')}
            </div>
          )}
        </div>
      )}

      {/* 震度速報 */}
      {flashReport && (
        <section
          aria-live="polite"
          style={{
            borderTop: '1px solid rgba(255,255,255,0.1)',
            marginTop: '8px',
            paddingTop: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ color: '#fbbf24', margin: '0 0 4px', fontSize: '13px' }}>
              震度速報（約1~2分後）
            </h4>
            <span style={{ color: '#94a3b8', fontSize: '10px' }}>T+{flashReport.issuedTime.toFixed(0)}s</span>
          </div>
          <p style={{ color: '#e2e8f0', fontSize: '11px', margin: '0 0 6px' }}>{flashReport.summary}</p>
          <div style={{ display: 'grid', gap: '4px', fontSize: '11px' }}>
            {INTENSITY_ORDER.flatMap((scale) => {
              const prefectures = flashReport.intensities[scale];
              return prefectures?.length
                ? [(
                    <div key={`flash-${scale}`} style={{ display: 'flex', gap: '6px' }}>
                      <strong style={{ color: '#fbbf24', minWidth: '40px' }}>震度{INTENSITY_LABELS[scale]}</strong>
                      <span style={{ color: '#e2e8f0' }}>{prefectures.join('、')}</span>
                    </div>
                  )]
                : [];
            })}
          </div>
        </section>
      )}

      {/* 震源・震度情報 */}
      {earthquakeInfoReport && (
        <section
          aria-live="polite"
          style={{
            borderTop: '1px solid rgba(255,255,255,0.1)',
            marginTop: '8px',
            paddingTop: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ color: '#60a5fa', margin: '0 0 4px', fontSize: '13px' }}>
              震源・震度情報（約3~5分後）
            </h4>
            <span style={{ color: '#94a3b8', fontSize: '10px' }}>T+{earthquakeInfoReport.issuedTime.toFixed(0)}s</span>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.25)', padding: '6px', borderRadius: '4px', marginBottom: '6px', fontSize: '11px' }}>
            <div><strong>震源地:</strong> {earthquakeInfoReport.epicenterName}</div>
            <div><strong>規模:</strong> M{earthquakeInfoReport.hypocenter.magnitude.toFixed(1)} / <strong>深さ:</strong> 約{Math.round(earthquakeInfoReport.hypocenter.depth)}km</div>
            <div><strong>最大震度:</strong> <span style={{ color: '#f87171', fontWeight: 'bold' }}>震度{INTENSITY_LABELS[earthquakeInfoReport.maxIntensity]}</span></div>
          </div>
          <div style={{ display: 'grid', gap: '4px', fontSize: '11px', maxHeight: '120px', overflowY: 'auto' }}>
            {INTENSITY_ORDER.flatMap((scale) => {
              const prefectures = earthquakeInfoReport.intensities[scale];
              return prefectures?.length
                ? [(
                    <div key={`detail-${scale}`} style={{ display: 'flex', gap: '6px' }}>
                      <strong style={{ color: '#60a5fa', minWidth: '40px' }}>震度{INTENSITY_LABELS[scale]}</strong>
                      <span style={{ color: '#cbd5e1' }}>{prefectures.join('、')}</span>
                    </div>
                  )]
                : [];
            })}
          </div>
        </section>
      )}

      {/* 長周期地震動に関する観測情報 */}
      {lpgmReport && (
        <section
          aria-live="polite"
          style={{
            borderTop: '1px solid rgba(255,255,255,0.1)',
            marginTop: '8px',
            paddingTop: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ color: '#c4b5fd', margin: '0 0 4px', fontSize: '13px' }}>
              長周期地震動観測情報（約10分後）
            </h4>
            <span style={{ color: '#94a3b8', fontSize: '10px' }}>T+{lpgmReport.issuedTime.toFixed(0)}s</span>
          </div>
          <div style={{ fontSize: '11px', marginBottom: '4px', color: '#cbd5e1' }}>
            最大階級: <strong style={{ color: '#c4b5fd' }}>階級 {lpgmReport.maxClass}</strong>
          </div>
          <div style={{ display: 'grid', gap: '4px', fontSize: '11px' }}>
            {[4, 3, 2, 1].map((cls) => {
              const matched = lpgmReport.affectedPrefectures.filter((p) => p.classLevel === cls);
              if (matched.length === 0) return null;
              return (
                <div key={`lpgm-${cls}`} style={{ display: 'flex', gap: '6px' }}>
                  <strong style={{ color: '#c4b5fd', minWidth: '40px' }}>階級{cls}</strong>
                  <span style={{ color: '#e2e8f0' }}>{matched.map((p) => p.prefName).join('、')}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};
