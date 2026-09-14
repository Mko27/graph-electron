/**
 * QueryPanel — dialect-aware query editor for the active tab.
 *
 * The picker above the editor selects the tab's **environment**, not a bare
 * connection: choosing one opens its graph endpoint and re-points DynamoDB, so
 * the two halves cannot disagree. Only environments with an endpoint are
 * offered — the rest are set up in the sidebar first.
 *
 * Execute never dead-ends on a disconnected environment; it connects first and
 * then runs (see AppContext.executeQuery).
 *
 * The editor's height is draggable from the bar along its bottom edge and is
 * remembered with the workspace. Dragging writes straight to the element's
 * style and only commits to state on release, so a long result set is not
 * re-rendered on every pointer move.
 *
 * The gutter numbers logical lines, not visual rows: a wrapped line keeps one
 * number and the gutter reserves the wrapped height for it, so the numbers stay
 * aligned with the text no matter how the editor is resized.
 *
 * Row counts come from a hidden *textarea* of the same width and font, measured
 * one line at a time through scrollHeight. A `<div>` mirror is the usual trick
 * but it is not equivalent: counting line boxes with getClientRects() over-
 * counts wrapped text whose rows end in spaces (9 rects for 5 rows), which
 * pushed every number below the first long line out of alignment. A textarea
 * wraps exactly like the textarea it mirrors, by construction.
 */

import { useCallback, useRef, useEffect, useLayoutEffect, useState } from 'react';
import { useApp } from '../state/AppContext';
import { DIALECT_LABELS } from '@graph-client/shared';

/** Floors for the drag: the editor stays usable, the results stay visible. */
const MIN_PANEL_HEIGHT = 120;
const MIN_RESULTS_HEIGHT = 180;

const DIALECT_PLACEHOLDERS: Record<string, string> = {
  gremlin:    'g.V().limit(10)\ng.V().hasLabel(\'person\').values(\'name\')',
  opencypher: 'MATCH (n) RETURN n LIMIT 10\nMATCH (n:Person) RETURN n.name',
  cypher:     'MATCH (n) RETURN n LIMIT 10\nCALL db.labels()',
  gsql:       'SELECT * FROM VertexType LIMIT 10',
  ngql:       'SHOW TAGS;\nGO FROM "player100" OVER follow',
  graphql:    '{ __schema { types { name } } }',
  sparql:     'SELECT * WHERE { ?s ?p ?o } LIMIT 10',
};

/** Two spaces, matching the editor's existing indent width. */
const INDENT = '  ';

export function QueryPanel() {
  const {
    activeTab,
    activeTabId,
    activeTabEnvironment,
    activeTabConnection,
    configuredEnvironments,
    setTabEnvironment,
    connectEnvironment,
    reconnectEnvironment,
    executeQuery,
    cancelQuery,
    setTabQuery,
    queryPanelHeight,
    setQueryPanelHeight,
  } = useApp();

  const panelRef    = useRef<HTMLDivElement>(null);
  const dragRef     = useRef<{ pointerY: number; height: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef   = useRef<HTMLDivElement>(null);
  const mirrorRef   = useRef<HTMLTextAreaElement>(null);
  /** One entry per logical line: how many visual rows it wraps onto. */
  const [lineRows, setLineRows] = useState<number[]>([1]);
  /** Row counts by line text, dropped whenever the editor's width changes. */
  const rowCacheRef = useRef<{ width: number; rows: Map<string, number> }>({ width: 0, rows: new Map() });

  /**
   * Keep the editor usable and always leave room for the results below.
   * The ceiling is measured from the editor + results pair rather than from
   * their container, whose height also covers the tab bar and status bar —
   * charging those to the results is what let the results collapse.
   */
  const clampHeight = (px: number) => {
    const el = panelRef.current;
    const results = el?.parentElement?.querySelector('#resultsPanel');
    const flexible = (el?.getBoundingClientRect().height ?? 0)
      + (results?.getBoundingClientRect().height ?? MIN_RESULTS_HEIGHT);
    const max = Math.max(MIN_PANEL_HEIGHT, flexible - MIN_RESULTS_HEIGHT);
    return Math.round(Math.min(Math.max(px, MIN_PANEL_HEIGHT), max));
  };

  const onResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = panelRef.current;
    if (!el) return;
    dragRef.current = { pointerY: e.clientY, height: el.getBoundingClientRect().height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const el = panelRef.current;
    if (!drag || !el) return;
    el.style.height = `${clampHeight(drag.height + (e.clientY - drag.pointerY))}px`;
  };

  const onResizePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = panelRef.current;
    if (dragRef.current && el) setQueryPanelHeight(clampHeight(el.getBoundingClientRect().height));
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const nudge = (delta: number) => {
    const el = panelRef.current;
    if (el) setQueryPanelHeight(clampHeight(el.getBoundingClientRect().height + delta));
  };

  // A height that fitted a tall window would otherwise crush the results when
  // the window is made shorter.
  useEffect(() => {
    if (queryPanelHeight == null) return;
    const onWindowResize = () => {
      const clamped = clampHeight(queryPanelHeight);
      if (clamped !== queryPanelHeight) setQueryPanelHeight(clamped);
    };
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  });

  const query       = activeTab?.query ?? '';
  const isExecuting = activeTab?.isExecuting ?? false;
  const dialect     = activeTabConnection?.dialect ?? 'gremlin';

  const onExecute = useCallback(() => {
    if (activeTabId) executeQuery(activeTabId);
  }, [activeTabId, executeQuery]);

  const onCancel = useCallback(() => {
    if (activeTabId) cancelQuery(activeTabId);
  }, [activeTabId, cancelQuery]);

  const onClear = useCallback(() => {
    if (activeTabId) setTabQuery(activeTabId, '');
  }, [activeTabId, setTabQuery]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      onExecute();
    }
    if (e.key === 'Tab') {
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end   = el.selectionEnd;

      // With nothing selected, Tab is a plain two-space indent. Keyboard users
      // still need a way out of the editor, so Escape-then-Tab moves focus:
      // Tab is only swallowed when it is doing something useful here.
      if (start === end && !e.shiftKey) {
        e.preventDefault();
        const next = query.substring(0, start) + INDENT + query.substring(end);
        setTabQuery(activeTabId, next);
        requestAnimationFrame(() => {
          el.selectionStart = el.selectionEnd = start + INDENT.length;
        });
        return;
      }

      // A selection means indent/outdent every line it touches, rather than
      // replacing the whole selection with two spaces.
      e.preventDefault();
      const lineStart = query.lastIndexOf('\n', start - 1) + 1;
      const lineEndIdx = query.indexOf('\n', end);
      const lineEnd = lineEndIdx === -1 ? query.length : lineEndIdx;

      const block = query.slice(lineStart, lineEnd);
      const lines = block.split('\n');

      const shifted = e.shiftKey
        ? lines.map(line =>
            line.startsWith(INDENT) ? line.slice(INDENT.length) : line.replace(/^[ \t]/, ''),
          )
        : lines.map(line => INDENT + line);

      const delta = shifted[0].length - lines[0].length;
      const totalDelta = shifted.join('\n').length - block.length;

      setTabQuery(activeTabId, query.slice(0, lineStart) + shifted.join('\n') + query.slice(lineEnd));
      requestAnimationFrame(() => {
        el.selectionStart = Math.max(lineStart, start + delta);
        el.selectionEnd = Math.max(lineStart, end + totalDelta);
      });
    }
  }, [onExecute, query, activeTabId, setTabQuery]);

  // Re-measure whenever the text or the editor's width changes; wrapping is
  // what makes a line take more than one row.
  useLayoutEffect(() => {
    const measure = () => {
      const textarea = textareaRef.current;
      const mirror = mirrorRef.current;
      if (!textarea || !mirror) return;

      const style = getComputedStyle(textarea);
      const lineHeight = parseFloat(style.lineHeight);
      const contentWidth =
        textarea.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (!(lineHeight > 0) || !(contentWidth > 0)) return;

      mirror.style.width = `${contentWidth}px`;
      mirror.style.fontFamily = style.fontFamily;
      mirror.style.fontSize = style.fontSize;
      mirror.style.fontWeight = style.fontWeight;
      mirror.style.lineHeight = style.lineHeight;
      mirror.style.letterSpacing = style.letterSpacing;
      mirror.style.tabSize = style.tabSize;

      // Same text, same width, same element type — so the same wrapping.
      const cache = rowCacheRef.current;
      if (cache.width !== contentWidth || cache.rows.size > 4000) {
        cache.width = contentWidth;
        cache.rows.clear();
      }

      setLineRows(query.split('\n').map(line => {
        const cached = cache.rows.get(line);
        if (cached !== undefined) return cached;
        mirror.value = line;
        // The mirror has no padding and zero height, so scrollHeight is exactly
        // the height of the wrapped text.
        const rows = Math.max(1, Math.round(mirror.scrollHeight / lineHeight));
        cache.rows.set(line, rows);
        return rows;
      }));
    };

    measure();

    // The editor's font arrives asynchronously (Google Fonts). It re-wraps the
    // text without changing the textarea's size, so the resize observer alone
    // would leave the numbers measured against the fallback font.
    let cancelled = false;
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      void document.fonts.ready.then(() => { if (!cancelled) measure(); });
    }

    const textarea = textareaRef.current;
    if (!textarea || typeof ResizeObserver === 'undefined') return () => { cancelled = true; };
    const observer = new ResizeObserver(measure);
    observer.observe(textarea);
    return () => { cancelled = true; observer.disconnect(); };
  }, [query]);

  // The gutter scrolls with the text rather than having its own scrollbar.
  const onEditorScroll = () => {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  // The tab's own environment stays listed even if its endpoint was cleared,
  // so the picker never silently shows a different environment than the tab has.
  const options = activeTabEnvironment && !configuredEnvironments.some(e => e.id === activeTabEnvironment.id)
    ? [...configuredEnvironments, activeTabEnvironment]
    : configuredEnvironments;

  const state       = activeTabConnection?.state ?? null;
  const isConnected = state === 'connected';
  const canRun      = !!activeTabConnection && activeTabConnection.host.trim() !== '';

  return (
    <div id="queryPanel" ref={panelRef} style={queryPanelHeight ? { height: queryPanelHeight } : undefined}>
      <div className="query-header">
        <div className="query-env-selector">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2"/>
            <polyline points="2 17 12 22 22 17"/>
            <polyline points="2 12 12 17 22 12"/>
          </svg>
          <select
            className="conn-select env-select"
            value={activeTabEnvironment?.id ?? ''}
            onChange={e => { void setTabEnvironment(activeTabId, e.target.value || null); }}
            title="Environment this tab queries — selecting one connects it"
          >
            {/* A blank environment cannot run anything, so it exists only as a
                placeholder for a tab that has none, and cannot be chosen. */}
            {!activeTabEnvironment && (
              <option value="" disabled>
                {options.length ? 'Select environment…' : 'No environments — set one up in the sidebar'}
              </option>
            )}
            {options.map(env => (
              <option key={env.id} value={env.id}>{env.label}</option>
            ))}
          </select>

          {activeTabEnvironment && (
            <span className="env-state" title={activeTabConnection?.statusText ?? 'No endpoint configured'}>
              <span className={`status-conn-dot ${state ?? 'disconnected'}`} />
              {state === 'connecting'
                ? 'connecting…'
                : isConnected
                  ? 'connected'
                  : canRun
                    ? (state === 'error' ? 'error' : 'not connected')
                    : 'no endpoint'}
            </span>
          )}

          {activeTabEnvironment && canRun && !isConnected && state !== 'connecting' && (
            <button
              className="btn-sm btn-primary-sm"
              title={`Open ${activeTabEnvironment.label}`}
              onClick={() => {
                void (state === 'error'
                  ? reconnectEnvironment(activeTabEnvironment.id)
                  : connectEnvironment(activeTabEnvironment.id));
              }}
            >
              {state === 'error' ? 'Retry' : 'Connect'}
            </button>
          )}
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
          {isExecuting ? (
            <button
              className="btn btn-danger"
              title="Stop waiting for this query (the database may still finish it)"
              onClick={onCancel}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="6" y="6" width="12" height="12" rx="1.5" />
              </svg>
              Stop
            </button>
          ) : (
            <button
              className="btn btn-primary"
              title={
                !canRun
                  ? 'Pick an environment with an endpoint first'
                  : isConnected
                    ? 'Execute (Ctrl+Enter)'
                    : 'Connects this environment, then runs (Ctrl+Enter)'
              }
              onClick={onExecute}
              disabled={!canRun}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              {canRun && !isConnected ? 'Connect & Execute' : 'Execute'}
            </button>
          )}
        </div>
      </div>

      <div className="query-editor-wrapper">
        <div className="editor-gutter" ref={gutterRef} aria-hidden="true">
          {lineRows.map((rows, i) => (
            <div key={i} className="editor-gutter-line" style={{ height: `calc(${rows} * 1.6em)` }}>
              {i + 1}
            </div>
          ))}
        </div>
        <textarea className="editor-mirror" ref={mirrorRef} aria-hidden="true" tabIndex={-1} readOnly />
        <textarea
          id="queryEditor"
          ref={textareaRef}
          value={query}
          onChange={e => setTabQuery(activeTabId, e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={onEditorScroll}
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

      <div
        className="panel-resizer"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the query editor"
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
        onDoubleClick={() => setQueryPanelHeight(null)}
        onKeyDown={e => {
          const step = e.shiftKey ? 48 : 16;
          if (e.key === 'ArrowDown') { e.preventDefault(); nudge(step); }
          if (e.key === 'ArrowUp')   { e.preventDefault(); nudge(-step); }
          if (e.key === 'Home')      { e.preventDefault(); setQueryPanelHeight(null); }
        }}
      >
        <span className="panel-resizer-grip" />
      </div>
    </div>
  );
}
