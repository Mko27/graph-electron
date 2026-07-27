/**
 * StatusBar — shows global status message and active-tab result metadata.
 */

import { useApp } from '../state/AppContext';

export function StatusBar() {
  const { statusMessage, activeTab, activeTabConnection } = useApp();
  const result = activeTab?.result;

  return (
    <div id="statusBar">
      <div className="status-left">
        <span style={{ color: statusMessage.type === 'error' ? 'var(--danger)' : 'var(--text-muted)' }}>
          {statusMessage.message}
        </span>
      </div>
      <div className="status-right">
        {activeTabConnection && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className={`status-conn-dot ${activeTabConnection.state}`} />
            {activeTabConnection.name}
          </span>
        )}
        {result && (
          <>
            <span>{result.duration}ms</span>
            <span>{result.count} results</span>
          </>
        )}
      </div>
    </div>
  );
}
