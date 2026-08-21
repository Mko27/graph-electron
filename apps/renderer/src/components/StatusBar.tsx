/**
 * StatusBar — global status message, active DynamoDB environment, and
 * active-tab result metadata.
 *
 * The message keeps its full text in a tooltip, since a long provider error is
 * otherwise clipped by the bar's width. The environment chip is always visible
 * so it is never ambiguous which DynamoDB table enrichment is reading from.
 */

import { useApp } from '../state/AppContext';

export function StatusBar() {
  const { statusMessage, activeTab, activeTabConnection, dynamo } = useApp();
  const result = activeTab?.result;
  const env = dynamo.environments[dynamo.environment];

  return (
    <div id="statusBar">
      <div className="status-left">
        <span
          className={statusMessage.type === 'error' ? 'status-text-error' : 'status-text'}
          title={statusMessage.message}
        >
          {statusMessage.message}
        </span>
      </div>
      <div className="status-right">
        {env && (
          <span
            className={`status-env env-${dynamo.environment} ${dynamo.applied ? 'applied' : 'pending'}`}
            title={
              dynamo.applied
                ? `DynamoDB: ${dynamo.statusText}`
                : `DynamoDB config not applied — ${dynamo.statusText}`
            }
          >
            {env.label}: {env.tableName}
          </span>
        )}
        {activeTabConnection && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }} title={activeTabConnection.statusText}>
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
