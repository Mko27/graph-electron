/**
 * QueryTabs — horizontal tab bar above the query editor.
 * Each tab is an independent query session bound to one environment.
 */

import { useState, useRef, useEffect } from 'react';
import { useApp } from '../state/AppContext';
import type { TabObject, ConnectionState } from '../state/AppContext';

function TabLabel({
  tab, isActive, envLabel, dotState, onActivate, onClose, onRename,
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

  return (
    <div className="query-tabs-bar">
      <div className="query-tabs-scroll">
        {queryTabs.map(tab => {
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
            />
          );
        })}
      </div>
      <button className="tab-add-btn" title="New query tab" onClick={() => addTab()}>+</button>
    </div>
  );
}
