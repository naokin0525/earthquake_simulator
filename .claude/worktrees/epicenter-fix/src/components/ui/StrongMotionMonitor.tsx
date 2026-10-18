import React, { useEffect, useState } from 'react';
import { useSimulation } from '../../hooks/useSimulation';
import { StationTriggerEvent } from '../../core/types';

export const StrongMotionMonitor: React.FC = () => {
  const { stationBuffer, triggerEventsMap, isKyoshinMonitor } = useSimulation();
  const [entries, setEntries] = useState<Array<{ index: number; intensity: string; pgv: number }>>([]);

  useEffect(() => {
    if (!isKyoshinMonitor) return;
    const update = () => {
      const list: typeof entries = [];
      triggerEventsMap.forEach((ev: StationTriggerEvent, idx: number) => {
        list.push({ index: idx, intensity: ev.intensity, pgv: ev.pgvSurface });
      });
      setEntries(list);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [isKyoshinMonitor, triggerEventsMap]);

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
    </div>
  );
};
