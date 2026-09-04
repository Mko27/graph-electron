/**
 * StatusBar — global status message, the active tab's environment, and that
 * tab's result metadata.
 *
 * The environment chip carries both halves (graph state + DynamoDB table) so it
 * is never ambiguous which stage a result came from, and a table that the main
 * process has not accepted yet is shown as pending rather than authoritative.
 */

import { useApp } from '../state/AppContext';

export function StatusBar() {
  const { statusMessage, activeTab, activeTabEnvironment, activeTabConnection, dynamoRuntime } = useApp();
  const result = activeTab?.result;
  const env = activeTabEnvironment;
  const dynamoLive = env != null && dynamoRuntime.envId === env.id;

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
          <span title={activeTabConnection?.statusText ?? 'No endpoint configured'}>
            <span className={`status-conn-dot ${activeTabConnection?.state ?? 'disconnected'}`} />
            {env.label}
          </span>
        )}
        {env && env.dynamo.tableName && (
          <span
            className={`status-env ${dynamoLive && dynamoRuntime.applied ? 'applied' : 'pending'}`}
            title={
              dynamoLive
                ? `DynamoDB: ${dynamoRuntime.statusText}`
                : `DynamoDB config not applied — ${dynamoRuntime.statusText}`
            }
          >
            {env.dynamo.tableName}
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
