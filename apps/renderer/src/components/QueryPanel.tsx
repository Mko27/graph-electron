/**
 * QueryPanel — dialect-aware query editor for the active tab.
 *
 * Architecture fix: placeholder and labels reflect the active connection's
 * dialect (no hard-coded "Gremlin" strings).
 */

import { useCallback } from 'react';
import { useApp } from '../state/AppContext';
import { DIALECT_LABELS } from '@graph-client/shared';

const DIALECT_PLACEHOLDERS: Record<string, string> = {
  gremlin:    'g.V().limit(10)\ng.V().hasLabel(\'person\').values(\'name\')',
  opencypher: 'MATCH (n) RETURN n LIMIT 10\nMATCH (n:Person) RETURN n.name',
  cypher:     'MATCH (n) RETURN n LIMIT 10\nCALL db.labels()',
  gsql:       'SELECT * FROM VertexType LIMIT 10',
  ngql:       'SHOW TAGS;\nGO FROM "player100" OVER follow',
  graphql:    '{ __schema { types { name } } }',
  sparql:     'SELECT * WHERE { ?s ?p ?o } LIMIT 10',
};

export function QueryPanel() {
  const {
    activeTab,
    activeTabId,
    activeTabConnection,
    connections,
    executeQuery,
    setTabQuery,
    setTabConnection,
  } = useApp();

  const query       = activeTab?.query ?? '';
  const isExecuting = activeTab?.isExecuting ?? false;
  const dialect     = activeTabConnection?.dialect ?? 'gremlin';

  const onExecute = useCallback(() => {
    if (activeTabId) executeQuery(activeTabId);
  }, [activeTabId, executeQuery]);

  const onClear = useCallback(() => {
    if (activeTabId) setTabQuery(activeTabId, '');
  }, [activeTabId, setTabQuery]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      onExecute();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end   = el.selectionEnd;
      const next  = query.substring(0, start) + '  ' + query.substring(end);
      setTabQuery(activeTabId, next);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2; });
    }
  }, [onExecute, query, activeTabId, setTabQuery]);

  const connList   = Object.values(connections);
  const tabConnId  = activeTab?.connectionId ?? '';

  return (
    <div id="queryPanel">
      <div className="query-header">
        <div className="query-conn-selector">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3"/>
            <circle cx="4" cy="6" r="2"/><circle cx="20" cy="18" r="2"/>
            <line x1="6" y1="7" x2="9.5" y2="10"/><line x1="14.5" y1="14" x2="18" y2="17"/>
          </svg>
          <select
            className="conn-select"
            value={tabConnId}
            onChange={e => setTabConnection(activeTabId, e.target.value || null)}
            title="Select connection for this tab"
          >
            <option value="">
              Auto ({connList.find(c => c.state === 'connected')?.name ?? 'none connected'})
            </option>
            {connList.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.state} ({DIALECT_LABELS[c.dialect] ?? c.dialect})
              </option>
            ))}
          </select>
        </div>

        <div className="query-actions">
          <button className="btn btn-ghost" title="Clear" onClick={onClear}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-2 14H7L5 6"/>
              <path d="M10 11v6M14 11v6M9 6V4h6v2"/>
            </svg>
            Clear
          </button>
          <button
            className="btn btn-primary"
            title="Execute (Ctrl+Enter)"
            onClick={onExecute}
            disabled={isExecuting || !activeTabConnection || activeTabConnection.state !== 'connected'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            {isExecuting ? 'Executing…' : 'Execute'}
          </button>
        </div>
      </div>

      <div className="query-editor-wrapper">
        <textarea
          id="queryEditor"
          value={query}
          onChange={e => setTabQuery(activeTabId, e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Enter your ${DIALECT_LABELS[dialect] ?? dialect} query…\n\nExamples:\n  ${DIALECT_PLACEHOLDERS[dialect] ?? ''}`}
          spellCheck={false}
        />
        <div className="editor-hint">
          <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to execute
          {activeTabConnection && (
            <span style={{ marginLeft: 8, opacity: 0.6 }}>
              {DIALECT_LABELS[dialect] ?? dialect}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
