/**
 * QueryTabs — horizontal tab bar above the query editor.
 * Each tab represents an independent query + results session.
 */

import { useState, useRef, useEffect } from 'react';
import { useApp } from '../state/AppContext';
import type { TabObject } from '../state/AppContext';
import type { ConnectionObject } from '../state/AppContext';

function TabLabel({
  tab, isActive, connections, onActivate, onClose, onRename,
}: {
  tab: TabObject;
  isActive: boolean;
  connections: Record<string, ConnectionObject>;
  onActivate: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tab.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const connForTab = tab.connectionId ? connections[tab.connectionId] : null;
  const dotState   = connForTab ? connForTab.state : null;

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
      title={editing ? undefined : `${tab.name}${connForTab ? ` — ${connForTab.name}` : ''}`}
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
  const { queryTabs, activeTabId, setActiveTabId, addTab, closeTab, renameTab, connections } = useApp();

  return (
    <div className="query-tabs-bar">
      <div className="query-tabs-scroll">
        {queryTabs.map(tab => (
          <TabLabel
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            connections={connections}
            onActivate={() => setActiveTabId(tab.id)}
            onClose={() => closeTab(tab.id)}
            onRename={name => renameTab(tab.id, name)}
          />
        ))}
      </div>
      <button className="tab-add-btn" title="New query tab" onClick={() => addTab()}>+</button>
    </div>
  );
}
