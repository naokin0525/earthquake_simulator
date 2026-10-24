/**
 * src/App.tsx
 * ==========
 * Main application layout that mirrors the vanilla.html UI.
 * It combines the MapLibre GL + Deck.gl map, the JMA timeline,
 * the HUD panel, the floating control panel, and the intensity legend.
 */

import React from 'react';
import { SimulationProvider } from './context/SimulationContext';
import { MapContainer } from './components/map/MapContainer';
import { ControlPanel } from './components/ui/ControlPanel';
import { EEWHud } from './components/ui/EEWHud';
import { Legend } from './components/ui/Legend';
import { JmaTimeline } from './components/ui/JmaTimeline';
import { StrongMotionMonitor } from './components/ui/StrongMotionMonitor';
import { StartupLoadingScreen } from './components/ui/StartupLoadingScreen';

export const App: React.FC = () => (
  <SimulationProvider>
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950">
      {/* Map & WebGL Canvas */}
      <MapContainer />

      {/* UI overlay container – pointer-events are enabled per panel */}
      <div className="absolute inset-0 pointer-events-none z-10">
        <JmaTimeline />
        <EEWHud />
        <ControlPanel />
        <Legend />
        <StrongMotionMonitor />
      </div>
      <StartupLoadingScreen />
    </div>
  </SimulationProvider>
);

export default App;
