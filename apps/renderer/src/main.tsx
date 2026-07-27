/**
 * main.tsx — React renderer entry point.
 * Replaces: client/renderer.jsx
 */

import { createRoot } from 'react-dom/client';
import { AppProvider } from './state/AppContext';
import { App } from './app/App';

window.onerror = (message, source, lineno, colno, error) => {
  console.error('[renderer] Uncaught error:', message, `\n  at ${source}:${lineno}:${colno}`, error);
};

window.addEventListener('unhandledrejection', (event) => {
  console.error('[renderer] Unhandled promise rejection:', event.reason);
});

const root = createRoot(document.getElementById('root')!);
root.render(
  <AppProvider>
    <App />
  </AppProvider>,
);
