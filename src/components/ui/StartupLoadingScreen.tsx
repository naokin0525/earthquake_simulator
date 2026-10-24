import React from 'react';
import { useSimulation } from '../../hooks/useSimulation';

export const StartupLoadingScreen: React.FC = () => {
  const { isReady, startupPhase, startupProgress, startupError, retryStartup } = useSimulation();

  if (isReady) return null;

  const percentage = startupProgress.total > 0
    ? Math.floor((startupProgress.completed / startupProgress.total) * 100)
    : 0;
  const isIndeterminate = startupPhase !== 'tiles' || startupProgress.total === 0;
  const phaseLabel = startupPhase === 'tiles'
    ? '地盤増幅タイルを読み込んでいます'
    : startupPhase === 'stations'
      ? '観測点データを準備しています'
      : 'シミュレーションを初期化しています';

  return (
    <div className="startup-loading">
      <section className="startup-loading-panel" role="dialog" aria-modal="true" aria-labelledby="startup-loading-title">
        <h1 id="startup-loading-title">Earthquake Simulator</h1>
        {startupError ? (
          <>
            <p className="startup-loading-error" role="alert">起動データを読み込めませんでした。</p>
            <p className="startup-loading-detail">{startupError}</p>
            <button type="button" className="startup-loading-retry" onClick={retryStartup}>
              再試行
            </button>
          </>
        ) : (
          <>
            <p role="status" aria-live="polite">{phaseLabel}</p>
            <div
              className="startup-progress-track"
              role="progressbar"
              aria-label={phaseLabel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={isIndeterminate ? undefined : percentage}
            >
              <div
                className={`startup-progress-fill${isIndeterminate ? ' is-indeterminate' : ''}`}
                style={{ width: isIndeterminate ? undefined : `${percentage}%` }}
              />
            </div>
            {startupPhase === 'tiles' && startupProgress.total > 0 && (
              <p className="startup-loading-count">
                {startupProgress.completed.toLocaleString()} / {startupProgress.total.toLocaleString()} タイル
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
};
