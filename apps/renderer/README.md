# @graph-client/renderer

React renderer process. Canvas graph visualization, query editor, results panel.

**Rule:** Never import from `@graph-client/core` directly. Only communicate with the
main process via typed IPC wrappers in `src/api/`.

## Structure

```
src/
├── app/           ← App root, router, providers
├── components/    ← Reusable UI components
│   ├── Sidebar.jsx
│   ├── QueryPanel.jsx
│   ├── QueryTabs.jsx
│   ├── ResultsPanel.jsx
│   └── StatusBar.jsx
├── pages/         ← Full-page views (future)
├── hooks/
│   └── useEventBus.js
├── api/           ← IPC wrappers — import IpcChannels from @graph-client/shared
│   └── graphApi.ts  (target location; currently in client/api.js)
└── state/
    └── AppContext.jsx   ← Global state (connections, tabs, active connection)
```

## State model

```
AppContext
├── connections: Record<id, ConnectionObject>   ← keyed by connection ID
├── queryTabs: TabObject[]                      ← per-tab query state
└── activeTabId: string

TabObject
├── id, name
├── query                 ← current editor content
├── result               ← last successful result
├── error                ← last error string
├── isExecuting          ← loading state
├── connectionId         ← which connection this tab is attached to
├── activeResultTab      ← 'graph' | 'table' | 'json'
└── history: string[]    ← query history stack
```

## IPC usage

```typescript
// ✅ correct — use IpcChannels constant, import contract type
import { IpcChannels } from '@graph-client/shared';
import type { GraphQueryRequest } from '@graph-client/shared';

const req: GraphQueryRequest = { id: connectionId, query };
const result = await window.graphClient.invoke(IpcChannels.GRAPH_QUERY, req);

// ❌ wrong — raw string literal, no type safety
const result = await window.graphClient.invoke('graph:query', { id, query });
```

## Canvas visualizations

Three canvas renderers in `src/canvas/` (migration target from `client/canvas/`):

| File | Purpose |
|------|---------|
| `CanvasGraph.js` | Force-directed graph — vertices as nodes, edges as links |
| `CanvasTable.js` | Tabular result view |
| `CanvasJson.js` | Syntax-highlighted JSON tree |
