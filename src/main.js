import { jsx as _jsx } from "react/jsx-runtime";
/**
 * src/main.tsx
 * ============
 * React DOM root renderer.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
ReactDOM.createRoot(document.getElementById('root')).render(_jsx(React.StrictMode, { children: _jsx(App, {}) }));
