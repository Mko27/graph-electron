/**
 * Sidebar — one headline configuration section plus the query helpers, each one
 * collapsible.
 *
 *   ENVIRONMENTS   — graph endpoint + DynamoDB source per environment (see
 *                    EnvironmentsSection); tabs pick from the configured ones
 *   SCHEMA         — labels of the active tab's environment
 *   HISTORY        — queries run in the active tab
 *   QUICK QUERIES  — dialect-aware starters
 *
 * The helpers all describe the *active tab's* environment, so the sidebar never
 * shows a schema or dialect belonging to something the tab is not querying.
 * Every section's open/closed state is persisted with the workspace.
 *
 * Architecture rules:
 *   ✅ Endpoints are ProviderConnectionDto (all 9 database types)
 *   ✅ Quick queries generated from the active connection's dialect
 *   ✅ Schema explorer gated on connection.capabilities.supportsSchema
 *   ✅ Schema insert query adapts to dialect (Gremlin vs Cypher)
 */

import { useApp } from '../state/AppContext';
import { DB_TYPE_LABELS, DIALECT_LABELS } from '@graph-client/shared';
import { CollapsibleSection } from './CollapsibleSection';
import { EnvironmentsSection } from './EnvironmentsSection';
import { hostPlatform } from '../api/graphApi';

// ── Section ids (persistence keys — renaming resets a section to its default) ─

const SECTION_SCHEMA  = 'schema';
const SECTION_HISTORY = 'history';
const SECTION_QUICK   = 'quick-queries';

// ── Icons ─────────────────────────────────────────────────────────────────────

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const IconSchema = (
  <svg width="15" height="15" {...svgProps}>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
  </svg>
);

const IconClock = (
  <svg width="15" height="15" {...svgProps}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const IconBolt = (
  <svg width="15" height="15" {...svgProps}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const IconRefresh = (
  <svg width="13" height="13" {...svgProps} strokeWidth={2.5}>
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

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
    { label: 'All Vertices',   query: 'SELECT * FROM VertexType' },
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

// ── Schema explorer ───────────────────────────────────────────────────────────

function SchemaSection() {
  const { activeTabEnvironment, activeTabConnection, loadSchema, setTabQuery, activeTabId } = useApp();

  const env  = activeTabEnvironment;
  const conn = activeTabConnection;

  const connected = conn?.state === 'connected';
  const supported = conn?.capabilities.supportsSchema ?? false;
  const schema    = conn?.schema ?? null;
  const vertices  = schema?.vertexLabels ?? [];
  const edges     = schema?.edgeLabels ?? [];

  const isGremlin = conn?.dialect === 'gremlin';
  const isCypher  = conn?.dialect === 'cypher' || conn?.dialect === 'opencypher';

  const insertVertexQuery = (label: string) => {
    if (isGremlin) setTabQuery(activeTabId, `g.V().hasLabel('${label}').limit(25)`);
    else if (isCypher) setTabQuery(activeTabId, `MATCH (n:${label}) RETURN n LIMIT 25`);
  };

  const insertEdgeQuery = (label: string) => {
    if (isGremlin) setTabQuery(activeTabId, `g.E().hasLabel('${label}').limit(25)`);
    else if (isCypher) setTabQuery(activeTabId, `MATCH ()-[r:${label}]->() RETURN r LIMIT 25`);
  };

  const summary = schema && (vertices.length > 0 || edges.length > 0)
    ? <span className="sb-chip">{vertices.length} V · {edges.length} E</span>
    : env
      ? <span className="sb-chip">{env.label}</span>
      : undefined;

  return (
    <CollapsibleSection
      id={SECTION_SCHEMA}
      title="Schema"
      icon={IconSchema}
      defaultOpen={false}
      summary={summary}
      actions={conn && connected && supported ? (
        <button className="btn-icon" title="Reload schema" onClick={() => loadSchema(conn.id)}>
          {IconRefresh}
        </button>
      ) : undefined}
    >
      {!env && <div className="empty-state">This tab has no environment yet.</div>}
      {env && !conn && (
        <div className="empty-state"><strong>{env.label}</strong> has no endpoint yet.</div>
      )}
      {env && conn && !connected && (
        <div className="empty-state">Connect <strong>{env.label}</strong> to load its labels.</div>
      )}
      {conn && connected && !supported && (
        <div className="empty-state">
          {DB_TYPE_LABELS[conn.dbType] ?? conn.dbType} does not expose a schema.
        </div>
      )}
      {conn && connected && supported && (
        <div className="schema-content">
          {conn.schemaLoading && <div className="schema-loading"><span className="loading-spinner" /> Loading…</div>}
          {conn.schemaError && (
            <div className="schema-loading" style={{ color: 'var(--danger)' }}>Failed: {conn.schemaError}</div>
          )}
          {schema && !conn.schemaLoading && (
            <>
              {vertices.length > 0 && (
                <div className="schema-group">
                  <div className="schema-group-title">Vertices ({vertices.length})</div>
                  <div>
                    {vertices.map(v => (
                      <span key={v.label} className="schema-tag vertex" onClick={() => insertVertexQuery(v.label)}>
                        {v.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {edges.length > 0 && (
                <div className="schema-group">
                  <div className="schema-group-title">Edges ({edges.length})</div>
                  <div>
                    {edges.map(e => (
                      <span key={e.label} className="schema-tag edge" onClick={() => insertEdgeQuery(e.label)}>
                        {e.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {vertices.length === 0 && edges.length === 0 && (
                <div className="schema-loading">No schema data. Click reload.</div>
              )}
            </>
          )}
          {!schema && !conn.schemaLoading && !conn.schemaError && (
            <div className="empty-state">
              <button className="link-btn" onClick={() => loadSchema(conn.id)}>Load schema</button>
            </div>
          )}
        </div>
      )}
    </CollapsibleSection>
  );
}

// ── Query history ─────────────────────────────────────────────────────────────

function HistorySection() {
  const { activeTab, setTabQuery, activeTabId } = useApp();
  const history = activeTab?.history ?? [];

  return (
    <CollapsibleSection
      id={SECTION_HISTORY}
      title="History"
      icon={IconClock}
      defaultOpen={false}
      summary={
        <span className="sb-chip">
          {activeTab ? `${activeTab.name} · ${history.length}` : String(history.length)}
        </span>
      }
    >
      <div className="query-history">
        {history.length === 0 ? (
          <div className="empty-state">No queries yet</div>
        ) : (
          history.map((item, i) => (
            <div
              key={i}
              className={`history-item ${item.success ? 'success' : 'error'}`}
              title={item.query}
              onClick={() => setTabQuery(activeTabId, item.query)}
            >
              <span className="history-query">{item.query}</span>
              <span className="history-time">{item.timestamp}</span>
            </div>
          ))
        )}
      </div>
    </CollapsibleSection>
  );
}

// ── Quick queries ─────────────────────────────────────────────────────────────

function QuickQuerySection() {
  const { setTabQuery, activeTabId, activeTabConnection } = useApp();
  const dialect = activeTabConnection?.dialect ?? 'gremlin';
  const queries = QUICK_QUERIES[dialect] ?? QUICK_QUERIES['gremlin'];

  return (
    <CollapsibleSection
      id={SECTION_QUICK}
      title="Quick Queries"
      icon={IconBolt}
      defaultOpen={false}
      summary={<span className="sb-chip">{DIALECT_LABELS[dialect] ?? dialect}</span>}
    >
      <div className="quick-queries">
        {queries.map((q, i) => (
          <button key={i} className="quick-query-btn" onClick={() => setTabQuery(activeTabId, q.query)}>
            {q.label}
          </button>
        ))}
      </div>
    </CollapsibleSection>
  );
}

// ── Sidebar (main export) ─────────────────────────────────────────────────────

export function Sidebar() {
  // On Windows the title bar already carries the wordmark (see TitleBar), so
  // repeating it here would just be a second "Graph Client" two rows down.
  const showWordmark = hostPlatform !== 'win32';

  return (
    <aside id="sidebar">
      {showWordmark && (
      <div className="sidebar-header">
        <div className="logo">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3"/>
            <circle cx="4" cy="6" r="2"/><circle cx="20" cy="6" r="2"/>
            <circle cx="4" cy="18" r="2"/><circle cx="20" cy="18" r="2"/>
            <line x1="6" y1="6" x2="9.5" y2="10.5"/><line x1="18" y1="6" x2="14.5" y2="10.5"/>
            <line x1="6" y1="18" x2="9.5" y2="13.5"/><line x1="18" y1="18" x2="14.5" y2="13.5"/>
          </svg>
          <span>Graph Client</span>
        </div>
      </div>
      )}
      <div className="sidebar-sections">
        <EnvironmentsSection />
        <SchemaSection />
        <HistorySection />
        <QuickQuerySection />
      </div>
    </aside>
  );
}
