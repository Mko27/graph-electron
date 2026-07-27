/**
 * App — root layout component.
 * Sidebar | main content (QueryTabs + QueryPanel + ResultsPanel + StatusBar)
 */

import { Sidebar }      from '../components/Sidebar';
import { QueryTabs }    from '../components/QueryTabs';
import { QueryPanel }   from '../components/QueryPanel';
import { ResultsPanel } from '../components/ResultsPanel';
import { StatusBar }    from '../components/StatusBar';

export function App() {
  return (
    <div id="app">
      <Sidebar />
      <main id="mainContent">
        <QueryTabs />
        <QueryPanel />
        <ResultsPanel />
        <StatusBar />
      </main>
    </div>
  );
}
