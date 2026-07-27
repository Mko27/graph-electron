# @graph-client/electron

Electron main process. Owns the application window, IPC handler registration, and app lifecycle.

**Rule:** No business logic here. Delegate everything to `@graph-client/core`.

## Structure

```
src/
├── main.ts (→ currently server/main.js, migration pending)
│
├── ipc/
│   ├── registry.ts        ← THE ONLY PLACE that calls ipcMain.handle()
│   └── handlers/
│       ├── connectionHandlers.ts  ← graph:connect, graph:disconnect, graph:health, etc.
│       ├── queryHandlers.ts       ← graph:query, graph:schema
│       └── dynamoHandlers.ts      ← dynamo-configure, dynamo-fetch-item, etc.
│
├── windows/
│   ├── mainWindow.ts    ← BrowserWindow factory
│   └── preload.ts       ← contextBridge — defines window.graphClient API
│
└── services/
    └── DynamoService.ts ← Bridge to legacy DynamoService.js
```

## Adding a new IPC endpoint (step by step)

1. Add the channel name to `packages/shared/src/ipc/channels.ts`
2. Add request/response types to `packages/shared/src/ipc/contracts.ts`
3. Add the handler function to the appropriate file in `ipc/handlers/`
4. Register it in `ipc/registry.ts`
5. Add the client wrapper to `apps/renderer/src/api/`

## Migration status

`server/main.js` is the active entry point. `apps/electron/src/` contains
the target TypeScript architecture. Migration is done by moving handlers
from `server/main.js` into `apps/electron/src/ipc/handlers/` one at a time.
