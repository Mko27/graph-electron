/**
 * App — root layout component.
 * [TitleBar (Windows only)] / Sidebar | main content (QueryTabs + QueryPanel + ResultsPanel + StatusBar)
 */

import { Sidebar }      from '../components/Sidebar';
import { QueryTabs }    from '../components/QueryTabs';
import { QueryPanel }   from '../components/QueryPanel';
import { ResultsPanel } from '../components/ResultsPanel';
import { StatusBar }    from '../components/StatusBar';
import { TitleBar }     from '../components/TitleBar';
import { Toasts }       from '../components/Toasts';
import { hostPlatform } from '../api/graphApi';

export function App() {
  // Only Windows replaces its native caption bar with an app-coloured overlay,
  // so only Windows needs the app to draw the strip behind it.
  const needsTitleBar = hostPlatform === 'win32';

  return (
    <div id="appShell" className={needsTitleBar ? 'with-titlebar' : ''}>
      {needsTitleBar && <TitleBar />}
      <div id="app">
        <Sidebar />
        <main id="mainContent">
          <QueryTabs />
          <QueryPanel />
          <ResultsPanel />
          <StatusBar />
        </main>
      </div>
      <Toasts />
    </div>
  );
}
