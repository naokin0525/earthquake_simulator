import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { SimulationProvider } from './context/SimulationContext';
import { MapContainer } from './components/map/MapContainer';
import { EEWBanner } from './components/ui/EEWBanner';
import { ControlPanel } from './components/ui/ControlPanel';
import { EEWHud } from './components/ui/EEWHud';
import { Legend } from './components/ui/Legend';
export const App = () => {
    return (_jsx(SimulationProvider, { children: _jsxs("div", { className: "relative w-screen h-screen overflow-hidden bg-slate-950", children: [_jsx(MapContainer, {}), _jsxs("div", { className: "absolute inset-0 pointer-events-none z-10", children: [_jsx(EEWBanner, {}), _jsx(ControlPanel, {}), _jsx(EEWHud, {}), _jsx(Legend, {})] })] }) }));
};
export default App;
