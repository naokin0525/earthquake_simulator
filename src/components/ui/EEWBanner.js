import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useSimulation } from '../../hooks/useSimulation';
import { AlertTriangle } from 'lucide-react';
export const EEWBanner = () => {
    const { eewReport } = useSimulation();
    if (!eewReport || !eewReport.isWarning) {
        return null;
    }
    const est = eewReport.estimatedHypocenter;
    return (_jsx("div", { className: "absolute top-4 left-1/2 transform -translate-x-1/2 z-50 w-11/12 max-w-2xl pointer-events-auto", children: _jsxs("div", { className: "eew-flash-banner glass-panel p-4 rounded-xl text-white flex items-center justify-between border-2 border-red-500 shadow-2xl", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(AlertTriangle, { className: "w-8 h-8 text-yellow-300 animate-bounce flex-shrink-0" }), _jsxs("div", { children: [_jsxs("div", { className: "text-xl font-bold tracking-wider flex items-center space-x-2", children: [_jsx("span", { children: "\u7DCA\u6025\u5730\u9707\u901F\u5831 (\u8B66\u5831)" }), _jsxs("span", { className: "text-xs bg-red-800 text-red-200 px-2 py-0.5 rounded font-mono", children: ["\u7B2C ", eewReport.reportNumber, " \u5831 ", eewReport.isFinal ? '(最終報)' : ''] })] }), _jsxs("div", { className: "text-sm text-red-100 font-medium mt-0.5", children: ["\u63A8\u5B9A\u9707\u6E90: \u5317\u7DEF ", est.lat, "\u00B0 / \u6771\u7D4C ", est.lon, "\u00B0 (\u6DF1\u3055 ", est.depth, "km, M", est.magnitude, ")"] })] })] }), _jsxs("div", { className: "text-right flex-shrink-0 ml-4", children: [_jsx("div", { className: "text-xs text-red-200", children: "\u6700\u5927\u4E88\u6E2C\u9707\u5EA6" }), _jsx("div", { className: "text-3xl font-black text-yellow-300 drop-shadow", children: eewReport.maxPredictedIntensity })] })] }) }));
};
