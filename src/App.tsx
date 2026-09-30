/**
 * src/App.tsx
 * ===========
 * Main Application Layout combining MapLibre GL + Deck.gl canvas, Web Worker simulation bridge,
 * JMA EEW Warning alert banner, floating controls, status HUD, and intensity legend.
 */

import React from 'react';
import { SimulationProvider } from './context/SimulationContext';
import { MapContainer } from './components/map/MapContainer';
import { EEWBanner } from './components/ui/EEWBanner';
import { ControlPanel } from './components/ui/ControlPanel';
import { EEWHud } from './components/ui/EEWHud';
import { Legend } from './components/ui/Legend';

export const App: React.FC = () => {
  return (
    <SimulationProvider>
      <div className="relative w-screen h-screen overflow-hidden bg-slate-950">
        {/* Map & WebGL Canvas */}
        <MapContainer />

        {/* Floating UI Overlay Components */}
        <div className="absolute inset-0 pointer-events-none z-10">
          <EEWBanner />
          <ControlPanel />
          <EEWHud />
          <Legend />
        </div>
      </div>
    </SimulationProvider>
  );
};

export default App;
