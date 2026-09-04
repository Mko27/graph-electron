/**
 * main.tsx — React renderer entry point.
 * Replaces: client/renderer.jsx
 */

import { createRoot } from 'react-dom/client';
import { AppProvider } from './state/AppContext';
import { App } from './app/App';
import { subscribeToMainLog } from './api/graphApi';

window.onerror = (message, source, lineno, colno, error) => {
  console.error('[renderer] Uncaught error:', message, `\n  at ${source}:${lineno}:${colno}`, error);
};

window.addEventListener('unhandledrejection', (event) => {
  console.error('[renderer] Unhandled promise rejection:', event.reason);
});

// Mirror main-process log lines into this console. The main process used to
// achieve this by compiling a line of JavaScript per log call and running it
// here; it now sends the text as data over a dedicated channel.
subscribeToMainLog();

const root = createRoot(document.getElementById('root')!);
root.render(
  <AppProvider>
    <App />
  </AppProvider>,
);
