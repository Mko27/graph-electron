# @graph-client/shared

Zero-dependency types and constants shared between the Electron main process and the React renderer.

**Rule:** This package contains NO runtime logic. No Node.js APIs. No third-party imports.
Only TypeScript types, interfaces, plain objects, and string constants.

## What's inside

| File | Purpose |
|------|---------|
| `ipc/channels.ts` | `IpcChannels` — every IPC channel name as a typed constant |
| `ipc/contracts.ts` | Request and response types for every IPC channel |
| `constants/index.ts` | Default ports, display labels, timeout defaults |

## Why this package exists

Electron IPC is essentially an untyped message bus. Without a shared type layer,
the main process and renderer can drift out of sync silently.

By importing `IpcChannels` and the contract types in **both** apps, TypeScript catches
mismatches at compile time instead of at runtime.

```typescript
// In apps/electron/src/ipc/handlers/queryHandlers.ts
import { IpcChannels } from '@graph-client/shared';
ipcMain.handle(IpcChannels.GRAPH_QUERY, handler);

// In apps/renderer/src/api/graphApi.ts
import { IpcChannels } from '@graph-client/shared';
import type { GraphQueryRequest } from '@graph-client/shared';
const req: GraphQueryRequest = { id, query };
window.graphClient.invoke(IpcChannels.GRAPH_QUERY, req);
```

## Build

```bash
npm run build       # tsc → dist/
npm run typecheck   # tsc --noEmit
```

Build this package **before** building `@graph-client/core` or `@graph-client/electron`.
