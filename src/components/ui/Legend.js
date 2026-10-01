import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const JMA_SCALES = [
    { scale: '0', color: '#FFFFFF', label: '0' },
    { scale: '1', color: '#68C1F9', label: '1' },
    { scale: '2', color: '#C6F4CD', label: '2' },
    { scale: '3', color: '#FDEF72', label: '3' },
    { scale: '4', color: '#F6C344', label: '4' },
    { scale: '5-', color: '#E89939', label: '5弱' },
    { scale: '5+', color: '#DF742C', label: '5強' },
    { scale: '6-', color: '#EA4225', label: '6弱' },
    { scale: '6+', color: '#971E27', label: '6強' },
    { scale: '7', color: '#B825F7', label: '7' }
];
export const Legend = () => {
    return (_jsxs("div", { className: "glass-panel absolute bottom-6 left-6 z-40 p-3 rounded-xl text-white shadow-xl pointer-events-auto w-max", children: [_jsx("div", { className: "text-xs text-slate-400 font-medium mb-2", children: "\u6C17\u8C61\u5E81 \u9707\u5EA6\u968E\u7D1A" }), _jsx("div", { className: "flex items-center space-x-1", children: JMA_SCALES.map((item) => (_jsx("div", { className: "flex flex-col items-center", children: _jsx("div", { className: "w-6 h-6 rounded flex items-center justify-center font-bold text-xs shadow-sm", style: {
                            backgroundColor: item.color,
                            color: item.scale === '4' ? '#111' : '#fff'
                        }, children: item.label }) }, item.scale))) })] }));
};
