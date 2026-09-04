/**
 * ResultsPanel — tabbed results view (Table / JSON / Graph) for the active query tab.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useApp } from '../state/AppContext';
import { CanvasTable } from '../canvas/CanvasTable.js';
import { CanvasJson } from '../canvas/CanvasJson.js';
import { CanvasGraph } from '../canvas/CanvasGraph.js';
import { LABEL_MODE_AUTO, LABEL_MODE_LABEL, LABEL_MODE_ID, LABEL_MODE_NONE } from '../utils/helpers.js';
import { copyText } from '../utils/clipboard';
import { DynamoModal } from './DynamoModal';

const RESULT_TABS = [
  {
    id: 'table' as const,
    label: 'Table',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/>
        <line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/>
      </svg>
    ),
  },
  {
    id: 'json' as const,
    label: 'JSON',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
      </svg>
    ),
  },
  {
    id: 'graph' as const,
    label: 'Graph',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3"/><circle cx="4" cy="6" r="2"/><circle cx="20" cy="18" r="2"/>
        <line x1="6" y1="7" x2="9.5" y2="10"/><line x1="14.5" y1="14" x2="18" y2="17"/>
      </svg>
    ),
  },
];

/** Label modes that are not property keys. */
const LABEL_SENTINELS: string[] = [LABEL_MODE_AUTO, LABEL_MODE_LABEL, LABEL_MODE_ID, LABEL_MODE_NONE];

/** One vertex type in the loaded graph, as reported by CanvasGraph. */
interface LabelInfo {
  label: string;
  color: string;
  count: number;
  propertyKeys: string[];
  /** What Auto resolves to for this type, or null when it falls back to the id. */
  autoKey: string | null;
}

/** One edge type in the loaded graph. Auto draws the type itself. */
interface EdgeLabelInfo {
  label: string;
  count: number;
  propertyKeys: string[];
}

const IconLabels = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19 9.5 6 15 19" /><line x1="6.4" y1="14" x2="12.6" y2="14" />
    <line x1="18" y1="19" x2="21" y2="19" /><path d="M18 15.5a1.6 1.6 0 0 1 3 .9V19" />
  </svg>
);

// ── Canvas view wrappers ──────────────────────────────────────────────────────

function TableView({ data }: { data: unknown[] }) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<InstanceType<typeof CanvasTable> | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    rendererRef.current = new CanvasTable(canvasRef.current);
    return () => { rendererRef.current?.destroy(); rendererRef.current = null; };
  }, []);

  useEffect(() => { if (rendererRef.current && data) rendererRef.current.setData(data); }, [data]);

  return <div className="canvas-view-container"><canvas ref={canvasRef} /></div>;
}

function JsonView({ data }: { data: unknown[] }) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<InstanceType<typeof CanvasJson> | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    rendererRef.current = new CanvasJson(canvasRef.current);
    return () => { rendererRef.current?.destroy(); rendererRef.current = null; };
  }, []);

  useEffect(() => { if (rendererRef.current && data) rendererRef.current.setData(data); }, [data]);

  return <div className="canvas-view-container"><canvas ref={canvasRef} /></div>;
}

function GraphView({ data }: { data: unknown[] }) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<InstanceType<typeof CanvasGraph> | null>(null);

  const {
    graphLabelProperty, setGraphLabelProperty,
    graphLabelModes, setGraphLabelMode, resetGraphLabelModes,
    graphEdgeLabelModes, setGraphEdgeLabelMode,
    hydrateVertexProperties, hydrateEdgeProperties,
  } = useApp();
  const [dynamoModal, setDynamoModal] = useState<{ id: string; item: Record<string, unknown> } | null>(null);
  const [pinnedItem, setPinnedItem]   = useState<Record<string, unknown> | null>(null);
  const [graphError, setGraphError]   = useState<string | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [labelInfo, setLabelInfo] = useState<LabelInfo[]>([]);
  const [edgeLabelInfo, setEdgeLabelInfo] = useState<EdgeLabelInfo[]>([]);
  const [labelPanelOpen, setLabelPanelOpen] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const [graphInfo, setGraphInfo] = useState<{ nodeCount: number; edgeCount: number } | null>(null);
  const [graphWarning, setGraphWarning] = useState<string | null>(null);

  // The renderer is created once; the saved label choices seed it so the first
  // paint already uses them, and the effects below keep it in sync.
  const initialLabelProperty  = useRef(graphLabelProperty);
  const initialLabelModes     = useRef(graphLabelModes);
  const initialEdgeLabelModes = useRef(graphEdgeLabelModes);

  useEffect(() => {
    if (!canvasRef.current) return;
    rendererRef.current = new CanvasGraph(canvasRef.current, {
      onShowDynamoModal: (id: string, item: unknown) => setDynamoModal({ id, item: item as Record<string, unknown> }),
      labelProperty: initialLabelProperty.current,
      labelModes: initialLabelModes.current,
      edgeLabelModes: initialEdgeLabelModes.current,
    });
    return () => { rendererRef.current?.destroy(); rendererRef.current = null; };
  }, []);

  useEffect(() => {
    if (!rendererRef.current || !data) return;
    let cancelled = false;
    setGraphLoading(true);
    setGraphError(null);
    rendererRef.current.setData(data)
      .then(async () => {
        if (cancelled) return;
        setPinnedItem(null);
        setLabelInfo((rendererRef.current?.getLabelInfo() ?? []) as LabelInfo[]);
        setEdgeLabelInfo((rendererRef.current?.getEdgeLabelInfo() ?? []) as EdgeLabelInfo[]);
        // What the extractor actually made of the result — the counts say
        // straight away whether a missing edge was dropped on the way in or
        // never arrived, and the warning explains non-graph data.
        setGraphInfo(rendererRef.current?.getInfo() ?? null);
        setGraphWarning(rendererRef.current?.getWarning() ?? null);
        setGraphLoading(false);

        // `path()` results carry no properties, so without this every node in
        // such a graph would be labelled with its id. Fetch what the traversal
        // left out, then relabel in place.
        const missingNodes = rendererRef.current?.getNodesMissingProperties() ?? [];
        const missingEdges = rendererRef.current?.getEdgesMissingProperties() ?? [];
        if (missingNodes.length === 0 && missingEdges.length === 0) return;
        setHydrating(true);
        const [nodeProps, edgeProps] = await Promise.all([
          missingNodes.length ? hydrateVertexProperties(missingNodes) : Promise.resolve({}),
          missingEdges.length ? hydrateEdgeProperties(missingEdges) : Promise.resolve({}),
        ]);
        if (cancelled || !rendererRef.current) return;
        if (rendererRef.current.mergeNodeProperties(nodeProps) > 0) {
          setLabelInfo((rendererRef.current.getLabelInfo() ?? []) as LabelInfo[]);
          setGraphInfo(rendererRef.current.getInfo() ?? null);
        }
        if (rendererRef.current.mergeEdgeProperties(edgeProps) > 0) {
          setEdgeLabelInfo((rendererRef.current.getEdgeLabelInfo() ?? []) as EdgeLabelInfo[]);
        }
        setHydrating(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setGraphError(err.message || 'Failed to render graph');
        setGraphLoading(false);
        setHydrating(false);
      });
    return () => { cancelled = true; };
  }, [data, hydrateVertexProperties, hydrateEdgeProperties]);

  // Relabel in place — node positions are preserved.
  useEffect(() => {
    rendererRef.current?.setLabelProperty(graphLabelProperty);
  }, [graphLabelProperty]);

  useEffect(() => {
    rendererRef.current?.setLabelModes(graphLabelModes);
  }, [graphLabelModes]);

  useEffect(() => {
    rendererRef.current?.setEdgeLabelModes(graphEdgeLabelModes);
  }, [graphEdgeLabelModes]);

  useEffect(() => {
    if (!rendererRef.current) return;
    const interval = setInterval(() => {
      const next = rendererRef.current?.getPinnedItem() as Record<string, unknown> | undefined;
      if (next !== pinnedItem) setPinnedItem(next ?? null);
    }, 200);
    return () => clearInterval(interval);
  }, [pinnedItem]);

  const onCloseDetail = () => {
    setPinnedItem(null);
    if (rendererRef.current) {
      (rendererRef.current as unknown as Record<string, unknown>)._pinnedItem = null;
      (rendererRef.current as unknown as Record<string, unknown>)._dirty = true;
    }
  };

  return (
    <div className="canvas-view-container graph-view">
      <div className="graph-controls">
        <button
          className={`btn-icon ${labelPanelOpen ? 'active' : ''}`}
          title="Labels — choose what each vertex type shows"
          onClick={() => setLabelPanelOpen(open => !open)}
        >
          {IconLabels}
        </button>
        <button className="btn-icon" title="Fit to screen" onClick={() => rendererRef.current?.autoFit()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
          </svg>
        </button>
        <button className="btn-icon" title="Zoom In" onClick={() => rendererRef.current?.zoomIn()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </button>
        <button className="btn-icon" title="Zoom Out" onClick={() => rendererRef.current?.zoomOut()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </button>
      </div>

      {graphInfo && graphInfo.nodeCount > 0 && (
        <div className="graph-stats">
          <span>{graphInfo.nodeCount} {graphInfo.nodeCount === 1 ? 'vertex' : 'vertices'}</span>
          <span className="graph-stats-sep">·</span>
          <span className={graphInfo.edgeCount === 0 ? 'graph-stats-zero' : undefined}>
            {graphInfo.edgeCount} {graphInfo.edgeCount === 1 ? 'edge' : 'edges'}
          </span>
        </div>
      )}
      {graphWarning && (
        <div className="graph-warning-note" title={graphWarning}>⚠ {graphWarning}</div>
      )}

      {labelPanelOpen && (
        <LabelPanel
          info={labelInfo}
          edgeInfo={edgeLabelInfo}
          modes={graphLabelModes}
          edgeModes={graphEdgeLabelModes}
          fallback={graphLabelProperty}
          onPick={setGraphLabelMode}
          onPickEdge={setGraphEdgeLabelMode}
          onReset={() => { resetGraphLabelModes(); setGraphLabelProperty(LABEL_MODE_AUTO); }}
          onClose={() => setLabelPanelOpen(false)}
        />
      )}

      <canvas ref={canvasRef} />

      {graphLoading && (
        <div className="graph-loading-overlay">
          <div className="graph-loading-spinner" />
          <span>Processing graph…</span>
        </div>
      )}
      {graphError && <div className="graph-error-overlay"><span>⚠ {graphError}</span></div>}
      {hydrating && (
        <div className="graph-hydrating">
          <span className="loading-spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />
          Loading vertex properties…
        </div>
      )}

      {pinnedItem != null && (
        <DetailPanel
          item={pinnedItem}
          onClose={onCloseDetail}
          onFetchDynamo={id => setDynamoModal({ id, item: pinnedItem! })}
        />
      )}
      {dynamoModal && (
        <DynamoModal
          id={dynamoModal.id}
          graphItem={dynamoModal.item}
          onClose={() => setDynamoModal(null)}
        />
      )}
    </div>
  );
}

// ── Labels panel ──────────────────────────────────────────────────────────────

/**
 * One property choice per vertex type — a single global property cannot label a
 * mixed graph (picking `block_type` leaves every principal and resource node
 * falling back to its id). Choices live in AppContext, so they are shared by
 * every tab and restored on the next launch.
 */
function LabelPanel({ info, edgeInfo, modes, edgeModes, fallback, onPick, onPickEdge, onReset, onClose }: {
  info: LabelInfo[];
  edgeInfo: EdgeLabelInfo[];
  modes: Record<string, string>;
  edgeModes: Record<string, string>;
  fallback: string;
  onPick: (vertexLabel: string, mode: string) => void;
  onPickEdge: (edgeLabel: string, mode: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const customised =
    info.some(i => modes[i.label] !== undefined) ||
    edgeInfo.some(e => edgeModes[e.label] !== undefined) ||
    fallback !== LABEL_MODE_AUTO;

  return (
    <div className="graph-label-panel">
      <div className="glp-head">
        <span className="glp-title">Labels</span>
        <button className="btn-icon" title="Close" onClick={onClose}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <p className="glp-hint">What each type shows in the graph. Remembered for this workspace.</p>

      <div className="glp-group-title">Vertices</div>
      {info.length === 0 ? (
        <div className="empty-state">No vertices in these results.</div>
      ) : (
        <div className="glp-rows">
          {info.map(type => {
            const value = modes[type.label] ?? fallback;
            const known = LABEL_SENTINELS.includes(value) || type.propertyKeys.includes(value);
            return (
              <div className="glp-row" key={type.label}>
                <div className="glp-row-head">
                  <span className="glp-dot" style={{ background: type.color }} />
                  <span className="glp-name" title={type.label}>{type.label}</span>
                  <span className="glp-count">{type.count}</span>
                </div>
                <select value={value} onChange={e => onPick(type.label, e.target.value)}>
                  <option value={LABEL_MODE_AUTO}>
                    {type.autoKey ? `Auto — ${type.autoKey}` : 'Auto'}
                  </option>
                  <option value={LABEL_MODE_LABEL}>Vertex label</option>
                  <option value={LABEL_MODE_ID}>ID</option>
                  {type.propertyKeys.length > 0 && (
                    <optgroup label="Properties">
                      {type.propertyKeys.map(key => (
                        <option key={key} value={key}>{key}</option>
                      ))}
                    </optgroup>
                  )}
                  {/* A choice saved from an earlier result set may not exist on
                      this type — keep it selectable rather than silently reset. */}
                  {!known && <option value={value}>{value} (not on this type)</option>}
                </select>
              </div>
            );
          })}
        </div>
      )}

      <div className="glp-group-title">Edges</div>
      {edgeInfo.length === 0 ? (
        <div className="empty-state">No edges in these results.</div>
      ) : (
        <div className="glp-rows">
          {edgeInfo.map(type => {
            const value = edgeModes[type.label] ?? LABEL_MODE_AUTO;
            const known = LABEL_SENTINELS.includes(value) || type.propertyKeys.includes(value);
            return (
              <div className="glp-row" key={type.label}>
                <div className="glp-row-head">
                  <span className="glp-edge-swatch" />
                  <span className="glp-name" title={type.label}>{type.label}</span>
                  <span className="glp-count">{type.count}</span>
                </div>
                <select value={value} onChange={e => onPickEdge(type.label, e.target.value)}>
                  {/* Auto is the edge type itself — what an edge is read by. */}
                  <option value={LABEL_MODE_AUTO}>Auto — edge type</option>
                  <option value={LABEL_MODE_ID}>ID</option>
                  <option value={LABEL_MODE_NONE}>Hide</option>
                  {type.propertyKeys.length > 0 && (
                    <optgroup label="Properties">
                      {type.propertyKeys.map(key => (
                        <option key={key} value={key}>{key}</option>
                      ))}
                    </optgroup>
                  )}
                  {!known && <option value={value}>{value} (not on this type)</option>}
                </select>
              </div>
            );
          })}
        </div>
      )}

      {customised && (
        <div className="glp-foot">
          <button className="link-btn" onClick={onReset}>Reset all to Auto</button>
        </div>
      )}
    </div>
  );
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function DetailPanel({ item, onClose, onFetchDynamo }: {
  item: Record<string, unknown>;
  onClose: () => void;
  onFetchDynamo: (id: string) => void;
}) {
  if (!item) return null;
  const i = item as { type: string; data: Record<string, unknown> };
  const isNode = i.type === 'node';
  const data   = i.data;

  return (
    <div className="graph-detail-panel" style={{ display: 'block' }}>
      <div className="detail-panel-header">
        <span className={`detail-type-badge ${isNode ? 'detail-type-node' : 'detail-type-edge'}`}>
          {isNode ? 'VERTEX' : 'EDGE'}
        </span>
        <button className="detail-close-btn" onClick={onClose}>&times;</button>
      </div>
      <h4>{String(isNode ? data.fullLabel : (data.label ?? 'Edge'))}</h4>
      <div className="detail-row"><span className="detail-key">ID</span><span className="detail-value">{String(data.id)}</span></div>
      <div className="detail-row"><span className="detail-key">Label</span><span className="detail-value">{String(isNode ? data.fullLabel : (data.label ?? ''))}</span></div>
      {!isNode && (
        <>
          <div className="detail-row"><span className="detail-key">From</span><span className="detail-value">{String(data.fromLabel ?? '')} ({String(data.from)})</span></div>
          <div className="detail-row"><span className="detail-key">To</span><span className="detail-value">{String(data.toLabel ?? '')} ({String(data.to)})</span></div>
        </>
      )}
      {data.properties != null && Object.keys(data.properties as object).length > 0 && (
        <>
          <div className="detail-section-title">Properties</div>
          {Object.entries(data.properties as Record<string, unknown>).map(([key, val]) => (
            <div key={key} className="detail-row">
              <span className="detail-key">{key}</span>
              <span className="detail-value">{val == null ? '—' : String(val)}</span>
            </div>
          ))}
        </>
      )}
      {data.id != null && (
        <div className="detail-dynamo-section">
          <button className="detail-dynamo-btn" onClick={() => onFetchDynamo(String(data.id))}>
            🔍 Fetch from DynamoDB
          </button>
        </div>
      )}
    </div>
  );
}

// ── Error banner ──────────────────────────────────────────────────────────────

/**
 * Query errors were previously replaced by the results as soon as any older
 * data was present, and the text was neither selectable nor copyable. This
 * banner stays put until the next successful run, wraps the full message, and
 * offers a copy button.
 */
function ResultError({ message, connectionName, onRetry }: {
  message: string;
  connectionName?: string;
  onRetry?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    if (await copyText(message)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    }
  }, [message]);

  return (
    <div className="error-message" role="alert">
      <div className="error-message-head">
        <strong>✕ Query failed{connectionName ? ` on ${connectionName}` : ''}</strong>
        <div className="error-message-actions">
          {onRetry && (
            <button className="btn-sm btn-primary-sm" onClick={onRetry}>Reconnect</button>
          )}
          <button className="toast-link-btn" onClick={() => { void onCopy(); }}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <pre className="error-message-text">{message}</pre>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="empty-state-main">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
        <circle cx="12" cy="12" r="3"/>
        <circle cx="4" cy="6" r="2"/><circle cx="20" cy="6" r="2"/>
        <circle cx="4" cy="18" r="2"/><circle cx="20" cy="18" r="2"/>
        <line x1="6" y1="6" x2="9.5" y2="10.5"/><line x1="18" y1="6" x2="14.5" y2="10.5"/>
        <line x1="6" y1="18" x2="9.5" y2="13.5"/><line x1="18" y1="18" x2="14.5" y2="13.5"/>
      </svg>
      <h3>Ready to explore your graph</h3>
      <p>Pick an environment above the editor and execute a query to see results</p>
    </div>
  );
}

// ── ResultsPanel (main export) ────────────────────────────────────────────────

export function ResultsPanel() {
  const { activeTab, setTabResultView, activeTabId, activeTabConnection, reconnectConnection } = useApp();

  const result     = activeTab?.result ?? null;
  const error      = activeTab?.error ?? null;
  const activeView = activeTab?.activeResultTab ?? 'table';
  const data       = result?.data;
  const hasData    = data && data.length > 0;

  // Offer a reconnect only when the connection itself is the problem.
  const connectionDown = activeTabConnection != null && activeTabConnection.state !== 'connected';

  return (
    <div id="resultsPanel">
      <div className="results-tabs">
        {RESULT_TABS.map(tab => (
          <button
            key={tab.id}
            className={`tab-btn ${activeView === tab.id ? 'active' : ''}`}
            onClick={() => setTabResultView(activeTabId, tab.id)}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
        {result && (
          <div className="results-meta">
            <span>⏱ {result.duration}ms</span>
            <span>📊 {result.count} result{result.count !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      <div className="tab-content active">
        {error && (
          <ResultError
            message={error}
            connectionName={activeTabConnection?.name}
            onRetry={
              connectionDown && activeTabConnection
                ? () => { void reconnectConnection(activeTabConnection.id); }
                : undefined
            }
          />
        )}
        {!hasData ? (
          error ? null : <EmptyState />
        ) : (
          <>
            {activeView === 'table' && <TableView data={data} />}
            {activeView === 'json'  && <JsonView  data={data} />}
            {activeView === 'graph' && <GraphView data={data} />}
          </>
        )}
      </div>
    </div>
  );
}
