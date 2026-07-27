/**
 * ResultsPanel — tabbed results view (Table / JSON / Graph) for the active query tab.
 */

import { useState, useRef, useEffect } from 'react';
import { useApp } from '../state/AppContext';
import { CanvasTable } from '../canvas/CanvasTable.js';
import { CanvasJson } from '../canvas/CanvasJson.js';
import { CanvasGraph } from '../canvas/CanvasGraph.js';
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

  const [dynamoModal, setDynamoModal] = useState<{ id: string; item: Record<string, unknown> } | null>(null);
  const [pinnedItem, setPinnedItem]   = useState<Record<string, unknown> | null>(null);
  const [graphError, setGraphError]   = useState<string | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    rendererRef.current = new CanvasGraph(canvasRef.current, {
      onShowDynamoModal: (id: string, item: unknown) => setDynamoModal({ id, item: item as Record<string, unknown> }),
    });
    return () => { rendererRef.current?.destroy(); rendererRef.current = null; };
  }, []);

  useEffect(() => {
    if (!rendererRef.current || !data) return;
    setGraphLoading(true);
    setGraphError(null);
    rendererRef.current.setData(data)
      .then(() => { setPinnedItem(null); setGraphLoading(false); })
      .catch((err: Error) => { setGraphError(err.message || 'Failed to render graph'); setGraphLoading(false); });
  }, [data]);

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

      <canvas ref={canvasRef} />

      {graphLoading && (
        <div className="graph-loading-overlay">
          <div className="graph-loading-spinner" />
          <span>Processing graph…</span>
        </div>
      )}
      {graphError && <div className="graph-error-overlay"><span>⚠ {graphError}</span></div>}

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
      <p>Connect to a database and execute a query to see results</p>
    </div>
  );
}

// ── ResultsPanel (main export) ────────────────────────────────────────────────

export function ResultsPanel() {
  const { activeTab, setTabResultView, activeTabId } = useApp();

  const result     = activeTab?.result ?? null;
  const error      = activeTab?.error ?? null;
  const activeView = activeTab?.activeResultTab ?? 'table';
  const data       = result?.data;
  const hasData    = data && data.length > 0;

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
        {error && !hasData ? (
          <div className="error-message">❌ {error}</div>
        ) : !hasData ? (
          <EmptyState />
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
