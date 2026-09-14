/**
 * QueryTabs — horizontal tab bar above the query editor.
 * Each tab is an independent query session bound to one environment.
 */

import { useState, useRef, useEffect } from 'react';
import { useApp } from '../state/AppContext';
import type { TabObject, ConnectionState } from '../state/AppContext';

function TabLabel({
  tab, isActive, envLabel, dotState, onActivate, onClose, onRename, onNavigate,
}: {
  tab: TabObject;
  isActive: boolean;
  /** Environment this tab queries, for the tooltip. */
  envLabel: string | null;
  /** Endpoint state of that environment, or null when it has none. */
  dotState: ConnectionState | null;
  onActivate: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
  /** Move focus/selection by a delta in the tab strip (arrow keys). */
  onNavigate?: (delta: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tab.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const commitRename = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== tab.name) onRename(trimmed);
    else setDraft(tab.name);
  };

  return (
    <div
      className={`query-tab ${isActive ? 'active' : ''} ${tab.isExecuting ? 'executing' : ''}`}
      onClick={onActivate}
      onDoubleClick={() => { onActivate(); setEditing(true); }}
      title={editing ? undefined : `${tab.name}${envLabel ? ` — ${envLabel}` : ' — no environment'}`}
      // A tab strip is a tablist: arrow keys move between tabs, Enter/Space
      // activates, F2 renames. None of this was reachable without a mouse.
      role="tab"
      aria-selected={isActive}
      tabIndex={editing ? -1 : isActive ? 0 : -1}
      onKeyDown={e => {
        if (editing) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        } else if (e.key === 'F2') {
          e.preventDefault();
          onActivate();
          setEditing(true);
        } else if (e.key === 'Delete' || (e.key === 'w' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          onClose();
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          onNavigate?.(e.key === 'ArrowRight' ? 1 : -1);
        }
      }}
    >
      {dotState && <span className={`tab-conn-dot ${dotState}`} />}

      {editing ? (
        <input
          ref={inputRef}
          className="tab-name-input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') { setEditing(false); setDraft(tab.name); }
            e.stopPropagation();
          }}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <span className="tab-label-text">{tab.name}</span>
      )}

      {envLabel && !editing && <span className="tab-env-chip">{envLabel}</span>}

      {tab.isExecuting && <span className="tab-exec-spinner" />}

      <button
        className="tab-close-btn"
        title="Close tab"
        onClick={e => { e.stopPropagation(); onClose(); }}
      >
        ×
      </button>
    </div>
  );
}

export function QueryTabs() {
  const {
    queryTabs, activeTabId, setActiveTabId, addTab, closeTab, renameTab,
    environments, connections,
  } = useApp();

  // Arrow keys move along the strip, wrapping at both ends.
  const navigate = (fromIndex: number, delta: number) => {
    if (queryTabs.length < 2) return;
    const next = (fromIndex + delta + queryTabs.length) % queryTabs.length;
    setActiveTabId(queryTabs[next].id);
  };

  return (
    <div className="query-tabs-bar">
      <div className="query-tabs-scroll" role="tablist" aria-label="Query tabs">
        {queryTabs.map((tab, index) => {
          const env  = environments.find(e => e.id === tab.environmentId) ?? null;
          const conn = env?.connectionId ? connections[env.connectionId] ?? null : null;
          return (
            <TabLabel
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              envLabel={env?.label ?? null}
              dotState={conn?.state ?? null}
              onActivate={() => setActiveTabId(tab.id)}
              onClose={() => closeTab(tab.id)}
              onRename={name => renameTab(tab.id, name)}
              onNavigate={delta => navigate(index, delta)}
            />
          );
        })}
      </div>
      <button className="tab-add-btn" title="New query tab" aria-label="New query tab" onClick={() => addTab()}>+</button>
    </div>
  );
}
