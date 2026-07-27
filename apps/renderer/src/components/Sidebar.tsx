/**
 * Sidebar — connection manager, schema explorer, history, quick queries.
 *
 * Architecture fixes vs legacy:
 *   ✅ AddConnectionForm uses ProviderConnectionDto (all 9 db types)
 *   ✅ Dialect selector filtered by DIALECT_COMPATIBILITY[dbType]
 *   ✅ Quick queries generated from active connection's dialect (no hard-coded Gremlin)
 *   ✅ Schema explorer gated on connection.capabilities.supportsSchema
 *   ✅ Schema tags use new VertexSchemaDto shape (.label field)
 *   ✅ Schema insert query adapts to dialect (Gremlin vs Cypher)
 */

import { useState, useCallback } from 'react';
import { useApp } from '../state/AppContext';
import {
  DB_TYPE_LABELS,
  DIALECT_LABELS,
  DIALECT_COMPATIBILITY,
  DEFAULT_PORTS,
} from '@graph-client/shared';
import type { ProviderConnectionDto } from '@graph-client/shared';
import type { ConnectionObject } from '../state/AppContext';

// ── Quick query templates by dialect ─────────────────────────────────────────

const QUICK_QUERIES: Record<string, Array<{ label: string; query: string }>> = {
  gremlin: [
    { label: 'Vertices (25)',  query: 'g.V().limit(25)' },
    { label: 'Edges (25)',     query: 'g.E().limit(25)' },
    { label: 'Count Vertices', query: 'g.V().count()' },
    { label: 'Count Edges',    query: 'g.E().count()' },
    { label: 'Vertex Labels',  query: 'g.V().label().dedup()' },
    { label: 'Edge Labels',    query: 'g.E().label().dedup()' },
    { label: 'Sample Paths',   query: 'g.V().limit(50).path()' },
    { label: 'Traversal (25)', query: 'g.V().outE().inV().path().limit(25)' },
  ],
  opencypher: [
    { label: 'Nodes (25)',         query: 'MATCH (n) RETURN n LIMIT 25' },
    { label: 'Relationships (25)', query: 'MATCH ()-[r]->() RETURN r LIMIT 25' },
    { label: 'Count Nodes',        query: 'MATCH (n) RETURN count(n)' },
    { label: 'Node Labels',        query: 'MATCH (n) RETURN distinct labels(n)' },
    { label: 'Rel Types',          query: 'MATCH ()-[r]->() RETURN distinct type(r)' },
  ],
  cypher: [
    { label: 'Nodes (25)',         query: 'MATCH (n) RETURN n LIMIT 25' },
    { label: 'Relationships (25)', query: 'MATCH ()-[r]->() RETURN r LIMIT 25' },
    { label: 'Count Nodes',        query: 'MATCH (n) RETURN count(n) AS total' },
    { label: 'Node Labels',        query: 'CALL db.labels()' },
    { label: 'Rel Types',          query: 'CALL db.relationshipTypes()' },
    { label: 'Schema',             query: 'CALL db.schema.visualization()' },
  ],
  gsql: [
    { label: 'All Vertices',  query: 'SELECT * FROM VertexType' },
    { label: 'Count Vertices', query: 'SELECT count(*) FROM VertexType' },
  ],
  ngql: [
    { label: 'All Tags',   query: 'SHOW TAGS' },
    { label: 'All Edges',  query: 'SHOW EDGES' },
    { label: 'All Spaces', query: 'SHOW SPACES' },
  ],
  graphql: [
    { label: 'Schema', query: '{ __schema { types { name } } }' },
  ],
  sparql: [
    { label: 'Triples (25)', query: 'SELECT * WHERE { ?s ?p ?o } LIMIT 25' },
    { label: 'Types',        query: 'SELECT DISTINCT ?type WHERE { ?s a ?type } LIMIT 25' },
  ],
};

// ── DB-type specific form fields ──────────────────────────────────────────────

function DbSpecificFields({
  dbType,
  form,
  setForm,
}: {
  dbType: string;
  form: Record<string, string | boolean>;
  setForm: (f: Record<string, string | boolean>) => void;
}) {
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  switch (dbType) {
    case 'neo4j':
    case 'orientdb':
    case 'nebula':
      return (
        <>
          <div className="form-group">
            <label>Username</label>
            <input type="text" placeholder="neo4j" value={String(form.username ?? '')} onChange={set('username')} />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" placeholder="••••••••" value={String(form.password ?? '')} onChange={set('password')} />
          </div>
          {dbType === 'neo4j' && (
            <div className="form-group">
              <label>Database (optional)</label>
              <input type="text" placeholder="neo4j" value={String(form.database ?? '')} onChange={set('database')} />
            </div>
          )}
          {dbType === 'nebula' && (
            <div className="form-group">
              <label>Space (optional)</label>
              <input type="text" placeholder="my_space" value={String(form.space ?? '')} onChange={set('space')} />
            </div>
          )}
        </>
      );

    case 'arangodb':
      return (
        <>
          <div className="form-group">
            <label>Username (optional)</label>
            <input type="text" placeholder="root" value={String(form.username ?? '')} onChange={set('username')} />
          </div>
          <div className="form-group">
            <label>Password (optional)</label>
            <input type="password" placeholder="••••••••" value={String(form.password ?? '')} onChange={set('password')} />
          </div>
          <div className="form-group">
            <label>Database (optional)</label>
            <input type="text" placeholder="_system" value={String(form.database ?? '')} onChange={set('database')} />
          </div>
        </>
      );

    case 'cosmosdb':
      return (
        <>
          <div className="form-group">
            <label>Primary Key</label>
            <input type="password" placeholder="Azure primary key" value={String(form.primaryKey ?? '')} onChange={set('primaryKey')} />
          </div>
          <div className="form-group">
            <label>Database</label>
            <input type="text" placeholder="mydb" value={String(form.database ?? '')} onChange={set('database')} />
          </div>
          <div className="form-group">
            <label>Collection</label>
            <input type="text" placeholder="mygraph" value={String(form.collection ?? '')} onChange={set('collection')} />
          </div>
        </>
      );

    case 'tigergraph':
      return (
        <>
          <div className="form-group">
            <label>Graph Name (optional)</label>
            <input type="text" placeholder="MyGraph" value={String(form.graphName ?? '')} onChange={set('graphName')} />
          </div>
          <div className="form-group">
            <label>Bearer Token (optional)</label>
            <input type="password" placeholder="token" value={String(form.token ?? '')} onChange={set('token')} />
          </div>
        </>
      );

    default:
      return null;
  }
}

// ── Add Connection Form ───────────────────────────────────────────────────────

function AddConnectionForm({ onAdd, onCancel }: { onAdd: (dto: ProviderConnectionDto) => Promise<void>; onCancel: () => void }) {
  const [dbType, setDbType] = useState('neptune');
  const dialects = DIALECT_COMPATIBILITY[dbType] ?? ['gremlin'];
  const [dialect, setDialect] = useState(dialects[0]);
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(String(DEFAULT_PORTS['neptune'] ?? 8182));
  const [ssl, setSsl] = useState(true);
  const [extra, setExtra] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);

  const handleDbTypeChange = (t: string) => {
    setDbType(t);
    const newDialects = DIALECT_COMPATIBILITY[t] ?? ['gremlin'];
    setDialect(newDialects[0]);
    setPort(String(DEFAULT_PORTS[t] ?? 8182));
    setExtra({});
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!host.trim()) return;
    setBusy(true);
    const dto: ProviderConnectionDto = {
      id: `conn_${Date.now()}`,
      name: name.trim() || host.split('.')[0] || dbType,
      dbType,
      dialect,
      host: host.trim(),
      port: parseInt(port, 10) || DEFAULT_PORTS[dbType] || 8182,
      ssl,
      ...extra,
    };
    await onAdd(dto);
    setBusy(false);
  };

  return (
    <form className="add-conn-form" onSubmit={onSubmit}>
      <div className="form-group">
        <label>Database Type</label>
        <select value={dbType} onChange={e => handleDbTypeChange(e.target.value)} className="conn-select" style={{ width: '100%' }}>
          {Object.entries(DB_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Dialect</label>
        <select value={dialect} onChange={e => setDialect(e.target.value)} className="conn-select" style={{ width: '100%' }}>
          {dialects.map(d => (
            <option key={d} value={d}>{DIALECT_LABELS[d] ?? d}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Name (optional)</label>
        <input type="text" placeholder="Production" value={name} onChange={e => setName(e.target.value)} />
      </div>
      <div className="form-group">
        <label>Host</label>
        <input
          type="text"
          placeholder={dbType === 'neptune' ? 'cluster.region.neptune.amazonaws.com' : 'localhost'}
          value={host}
          onChange={e => setHost(e.target.value)}
          required
          autoFocus
        />
      </div>
      <div className="form-row">
        <div className="form-group" style={{ flex: 1 }}>
          <label>Port</label>
          <input type="number" value={port} onChange={e => setPort(e.target.value)} />
        </div>
        <div className="form-group checkbox-group" style={{ paddingTop: 20 }}>
          <label>
            <input type="checkbox" checked={ssl} onChange={e => setSsl(e.target.checked)} />
            <span>SSL</span>
          </label>
        </div>
      </div>
      <DbSpecificFields dbType={dbType} form={extra} setForm={setExtra} />
      <div className="form-row" style={{ gap: 8 }}>
        <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={busy}>
          {busy ? 'Connecting…' : 'Add & Connect'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ── Connection Card ───────────────────────────────────────────────────────────

function ConnectionCard({
  conn, isActive, onSelect, onConnect, onDisconnect, onRemove,
}: {
  conn: ConnectionObject;
  isActive: boolean;
  onSelect: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onRemove: () => void;
}) {
  const isConnected  = conn.state === 'connected';
  const isConnecting = conn.state === 'connecting';
  const isError      = conn.state === 'error';

  return (
    <div className={`conn-card ${isActive ? 'active' : ''}`} onClick={onSelect}>
      <div className="conn-card-header">
        <span className={`conn-dot ${conn.state}`} />
        <span className="conn-name">{conn.name}</span>
        <button
          className="btn-icon conn-remove-btn"
          title="Remove connection"
          onClick={e => { e.stopPropagation(); onRemove(); }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div className="conn-endpoint">{conn.host}:{conn.port} — {DB_TYPE_LABELS[conn.dbType] ?? conn.dbType}</div>
      <div className="conn-card-footer">
        <span className={`conn-state-text ${conn.state}`}>{conn.statusText}</span>
        {!isConnected && !isConnecting ? (
          <button className="btn-sm btn-primary-sm" onClick={e => { e.stopPropagation(); onConnect(); }}>Connect</button>
        ) : isConnected ? (
          <button className="btn-sm btn-danger-sm" onClick={e => { e.stopPropagation(); onDisconnect(); }}>Disconnect</button>
        ) : (
          <span className="conn-connecting-spinner">
            <span className="loading-spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
          </span>
        )}
      </div>
      {isError && <div className="conn-error-text">{conn.statusText}</div>}
    </div>
  );
}

function ConnectionsPanel() {
  const {
    connections, activeConnectionId, setActiveConnectionId,
    addConnection, connectConnection, disconnectConnection, removeConnection,
  } = useApp();

  const [showForm, setShowForm] = useState(false);
  const connList = Object.values(connections);

  const handleAdd = useCallback(async (dto: ProviderConnectionDto) => {
    const id = addConnection(dto);
    setShowForm(false);
    await connectConnection(id);
  }, [addConnection, connectConnection]);

  return (
    <div className="sidebar-section">
      <div className="section-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
          <polyline points="22,6 12,13 2,6"/>
        </svg>
        Connections
        <button className="btn-icon" title="Add connection" style={{ marginLeft: 'auto' }} onClick={() => setShowForm(v => !v)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>
      {showForm && <AddConnectionForm onAdd={handleAdd} onCancel={() => setShowForm(false)} />}
      {connList.length === 0 && !showForm && (
        <div className="empty-state" style={{ paddingBottom: 8 }}>
          No connections yet.{' '}
          <button className="link-btn" onClick={() => setShowForm(true)}>Add one</button>
        </div>
      )}
      <div className="conn-list">
        {connList.map(conn => (
          <ConnectionCard
            key={conn.id}
            conn={conn}
            isActive={conn.id === activeConnectionId}
            onSelect={() => setActiveConnectionId(conn.id)}
            onConnect={() => connectConnection(conn.id)}
            onDisconnect={() => disconnectConnection(conn.id)}
            onRemove={() => removeConnection(conn.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ── DynamoDB Config ───────────────────────────────────────────────────────────

function DynamoConfig() {
  const { handleDynamoConfig } = useApp();
  const [region, setRegion]     = useState('us-east-1');
  const [tableName, setTableName] = useState('blocks');
  const [host, setHost]         = useState('http://localhost:8000');
  const [configured, setConfigured] = useState(false);
  const [configText, setConfigText] = useState('');

  const onApply = async () => {
    const result = await handleDynamoConfig(
      region.trim() || 'us-east-1',
      tableName.trim() || 'blocks',
      host.trim() || undefined,
    );
    if (result?.success) {
      setConfigured(true);
      setConfigText(`${result.tableName} (${result.region})`);
    }
  };

  return (
    <div className="sidebar-section">
      <div className="section-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <ellipse cx="12" cy="5" rx="9" ry="3"/>
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
        </svg>
        DynamoDB Source
      </div>
      <div className="connection-form">
        <div className="form-group">
          <label>Host</label>
          <input type="text" placeholder="http://localhost:8000" value={host} onChange={e => setHost(e.target.value)} />
        </div>
        <div className="form-group">
          <label>AWS Region</label>
          <input type="text" placeholder="us-east-1" value={region} onChange={e => setRegion(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Table Name</label>
          <input type="text" placeholder="blocks" value={tableName} onChange={e => setTableName(e.target.value)} />
        </div>
        <button className="btn btn-ghost" style={{ width: '100%' }} onClick={onApply}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          Apply Config
        </button>
        {configured && (
          <div className="dynamo-config-status" style={{ display: 'flex' }}>
            <span className="dynamo-dot" />
            <span>{configText}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Schema Explorer ───────────────────────────────────────────────────────────

function SchemaExplorer() {
  const { connections, activeConnectionId, loadSchema, setTabQuery, activeTabId } = useApp();
  const conn = activeConnectionId ? connections[activeConnectionId] : null;

  if (!conn || conn.state !== 'connected') return null;
  if (!conn.capabilities.supportsSchema) return null;

  const { schema, schemaLoading, schemaError } = conn;

  const isGremlin = conn.dialect === 'gremlin';
  const isCypher  = conn.dialect === 'cypher' || conn.dialect === 'opencypher';

  const insertVertexQuery = (label: string) => {
    if (isGremlin) setTabQuery(activeTabId, `g.V().hasLabel('${label}').limit(25)`);
    else if (isCypher) setTabQuery(activeTabId, `MATCH (n:${label}) RETURN n LIMIT 25`);
  };

  const insertEdgeQuery = (label: string) => {
    if (isGremlin) setTabQuery(activeTabId, `g.E().hasLabel('${label}').limit(25)`);
    else if (isCypher) setTabQuery(activeTabId, `MATCH ()-[r:${label}]->() RETURN r LIMIT 25`);
  };

  return (
    <div className="sidebar-section">
      <div className="section-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
        </svg>
        Schema — {conn.name}
        <button className="btn-icon" title="Refresh" onClick={() => loadSchema(conn.id)} style={{ marginLeft: 'auto' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>
      </div>
      <div className="schema-content">
        {schemaLoading && <div className="schema-loading"><span className="loading-spinner" /> Loading…</div>}
        {schemaError && <div className="schema-loading" style={{ color: 'var(--danger)' }}>Failed: {schemaError}</div>}
        {schema && !schemaLoading && (
          <>
            {(schema.vertexLabels?.length ?? 0) > 0 && (
              <div className="schema-group">
                <div className="schema-group-title">Vertices ({schema.vertexLabels!.length})</div>
                <div>
                  {schema.vertexLabels!.map(v => (
                    <span key={v.label} className="schema-tag vertex" onClick={() => insertVertexQuery(v.label)}>
                      {v.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {(schema.edgeLabels?.length ?? 0) > 0 && (
              <div className="schema-group">
                <div className="schema-group-title">Edges ({schema.edgeLabels!.length})</div>
                <div>
                  {schema.edgeLabels!.map(e => (
                    <span key={e.label} className="schema-tag edge" onClick={() => insertEdgeQuery(e.label)}>
                      {e.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {!schema.vertexLabels?.length && !schema.edgeLabels?.length && (
              <div className="schema-loading">No schema data. Click refresh.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Query History ─────────────────────────────────────────────────────────────

function QueryHistoryPanel() {
  const { activeTab, setTabQuery, activeTabId } = useApp();
  const history = activeTab?.history ?? [];

  return (
    <div className="sidebar-section">
      <div className="section-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
        History
        {activeTab && <span className="section-badge">{activeTab.name}</span>}
      </div>
      <div className="query-history">
        {history.length === 0 ? (
          <div className="empty-state">No queries yet</div>
        ) : (
          history.map((item, i) => (
            <div
              key={i}
              className={`history-item ${item.success ? 'success' : 'error'}`}
              onClick={() => setTabQuery(activeTabId, item.query)}
            >
              <span className="history-query">{item.query}</span>
              <span className="history-time">{item.timestamp}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Quick Queries ─────────────────────────────────────────────────────────────

function QuickQueryPanel() {
  const { setTabQuery, activeTabId, activeTabConnection } = useApp();
  const dialect = activeTabConnection?.dialect ?? 'gremlin';
  const queries = QUICK_QUERIES[dialect] ?? QUICK_QUERIES['gremlin'];

  return (
    <div className="sidebar-section">
      <div className="section-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
        </svg>
        Quick Queries
        {activeTabConnection && (
          <span className="section-badge">{DIALECT_LABELS[dialect] ?? dialect}</span>
        )}
      </div>
      <div className="quick-queries">
        {queries.map((q, i) => (
          <button key={i} className="quick-query-btn" onClick={() => setTabQuery(activeTabId, q.query)}>
            {q.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Sidebar (main export) ─────────────────────────────────────────────────────

export function Sidebar() {
  return (
    <aside id="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3"/>
            <circle cx="4" cy="6" r="2"/><circle cx="20" cy="6" r="2"/>
            <circle cx="4" cy="18" r="2"/><circle cx="20" cy="18" r="2"/>
            <line x1="6" y1="6" x2="9.5" y2="10.5"/><line x1="18" y1="6" x2="14.5" y2="10.5"/>
            <line x1="6" y1="18" x2="9.5" y2="13.5"/><line x1="18" y1="18" x2="14.5" y2="13.5"/>
          </svg>
          <span>Graph Client</span>
        </div>
      </div>
      <ConnectionsPanel />
      <DynamoConfig />
      <SchemaExplorer />
      <QueryHistoryPanel />
      <QuickQueryPanel />
    </aside>
  );
}
