import React, { useEffect, useState } from 'react';
import { useSimulation } from '../../hooks/useSimulation';
import { StationTriggerEvent } from '../../core/types';

interface AmbientNoiseEntry {
  index: number;
  density: number;
}

export const StrongMotionMonitor: React.FC = () => {
  const { stationBuffer, triggerEventsMap, isKyoshinMonitor } = useSimulation();
  const [entries, setEntries] = useState<Array<{ index: number; intensity: string; pgv: number }>>([]);
  const [ambientNoiseEntries, setAmbientNoiseEntries] = useState<AmbientNoiseEntry[]>([]);
  const [noiseUpdatedAt, setNoiseUpdatedAt] = useState('');

  useEffect(() => {
    if (!isKyoshinMonitor) return;
    const update = () => {
      const list: typeof entries = [];
      triggerEventsMap.forEach((ev: StationTriggerEvent, idx: number) => {
        list.push({ index: idx, intensity: ev.intensity, pgv: ev.pgvSurface });
      });
      setEntries(list);
      const dailyNoise = stationBuffer?.dailyNoise;
      if (dailyNoise) {
        setAmbientNoiseEntries(
          Array.from(dailyNoise, (density, index) => ({ index, density }))
            .filter((entry) => Number.isFinite(entry.density) && entry.density > 0)
            .sort((a, b) => b.density - a.density)
            .slice(0, 20)
        );
        setNoiseUpdatedAt(new Date().toLocaleTimeString());
      } else {
        setAmbientNoiseEntries([]);
        setNoiseUpdatedAt('');
      }
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [isKyoshinMonitor, stationBuffer, triggerEventsMap]);

  if (!isKyoshinMonitor) return null;

  return (
    <div className="glass-panel hud" style={{ position: 'absolute', bottom: '20px', right: '20px', width: '300px', maxHeight: '400px', overflowY: 'auto', zIndex: 12 }}>
      <h3 className="text-cyan" style={{ margin: 0, marginBottom: '6px' }}>Strong Motion Monitor</h3>
      <table className="text-sm w-full">
        <thead>
          <tr>
            <th className="text-left">Station</th>
            <th className="text-center">Intensity</th>
            <th className="text-right">PGV</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(e => (
            <tr key={e.index}>
              <td>{e.index}</td>
              <td className="text-center">{e.intensity}</td>
              <td className="text-right">{e.pgv.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4 className="text-cyan" style={{ margin: '16px 0 6px' }}>
        Ambient noise inputs
      </h4>
      <p className="text-xs" style={{ margin: '0 0 6px', color: '#94a3b8' }}>
        Station population density (people/km²), refreshed every second
        {noiseUpdatedAt && ` · ${noiseUpdatedAt}`}
      </p>
      {ambientNoiseEntries.length > 0 ? (
        <table className="text-sm w-full">
          <thead>
            <tr>
              <th className="text-left">Station</th>
              <th className="text-right">Noise input</th>
            </tr>
          </thead>
          <tbody>
            {ambientNoiseEntries.map(({ index, density }) => (
              <tr key={index}>
                <td>{index}</td>
                <td className="text-right">{density.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-xs" style={{ color: '#94a3b8' }}>
          No station noise data available.
        </p>
      )}
    </div>
  );
};
