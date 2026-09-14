# Architecture

## Overview

Graph Client is a multi-provider graph database desktop application built on Electron + React.
It follows a **monorepo + hexagonal architecture** pattern: business logic lives in platform-agnostic
packages, while `apps/` contains platform-specific entry points.

```
┌─────────────────────────────────────────────────────────────────────┐
│  apps/renderer  (React)                                             │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  components / pages / state / hooks                          │  │
│  │                                                              │  │
│  │  api/  ─── typed wrappers around window.graphClient IPC ─── │  │
│  └───────────────────────────┬──────────────────────────────────┘  │
│                               │  IPC (packages/shared/ipc)          │
│  apps/electron  (Node.js)     │                                     │
│  ┌────────────────────────────▼─────────────────────────────────┐  │
│  │  ipc/registry.ts ──► handlers/ (connectionHandlers,          │  │
│  │                                 queryHandlers, etc.)         │  │
│  │  services/  (DynamoDB bridge, etc.)                          │  │
│  │  windows/   (BrowserWindow factory, preload)                 │  │
│  └───────────────────────────┬──────────────────────────────────┘  │
│                               │  imports                            │
│  packages/core                │                                     │
│  ┌────────────────────────────▼─────────────────────────────────┐  │
│  │  connection/ConnectionManager                                 │  │
│  │  graph/                                                       │  │
│  │    factory/ConnectionFactory  (bootstraps registries)        │  │
│  │    registry/ (ProviderRegistry, DialectRegistry)             │  │
│  │    pool/ConnectionPool                                        │  │
│  │    implementations/ (Neptune, Neo4j, ArangoDB, …)            │  │
│  │    dialects/         (Gremlin, Cypher, openCypher, nGQL, …)  │  │
│  │  query-engine/ResultTransformer                               │  │
│  │  auth/ logging/ utils/                                        │  │
│  └───────────────────────────┬──────────────────────────────────┘  │
│                               │  optional thin wrappers             │
│  packages/db-clients          │                                     │
│  ┌────────────────────────────▼─────────────────────────────────┐  │
│  │  neptune/NeptuneGremlinClient                                 │  │
│  │  neo4j/Neo4jBoltClient                                        │  │
│  │  arango/ArangoHttpClient                                      │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  packages/shared  (imported by BOTH apps and packages)              │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  ipc/channels.ts   (IpcChannels constants)                   │  │
│  │  ipc/contracts.ts  (request/response types)                  │  │
│  │  constants/        (default ports, labels)                   │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Package Responsibilities

### `packages/shared`
- **What:** Types + constants shared between main process and renderer.
- **Rule:** No runtime logic. No Node.js APIs. Pure types and plain objects only.
- **Key files:**
  - `ipc/channels.ts` — every IPC channel name in one place
  - `ipc/contracts.ts` — typed request/response shapes for every channel
  - `constants/index.ts` — default ports, display labels

### `packages/db-clients` — currently unused

Nothing imports this package. It predates the provider system in
`packages/core/src/graph/implementations/` which fully supersedes it. It is
kept under `npm run typecheck` so it cannot rot silently (it had accumulated a
real type error while excluded), but it is not part of the runtime path drawn
above.

#### Original description
- **What:** Thin transport-only wrappers over npm database drivers.
- **Rule:** Only connect/disconnect/submit raw bytes. No retry, no transformation, no schema logic.
- **Why a separate package:** Keeps driver upgrade surface minimal. Swapping `gremlin@3` for `gremlin@4` only touches this package.
- **Key classes:** `NeptuneGremlinClient`, `Neo4jBoltClient`, `ArangoHttpClient`

### `packages/core`
- **What:** All graph database business logic.
- **Rule:** No Electron APIs. No IPC. No `BrowserWindow`. Platform-agnostic.
- **Key concepts:**
  - `IGraphProvider` — the port every database adapter implements
  - `IQueryDialect` — stateless dialect validator/normalizer
  - `ProviderRegistry` / `DialectRegistry` — singleton registries; extend by calling `.register()`
  - `ConnectionFactory` — single entry point for creating providers; bootstraps registries on first use
  - `ConnectionPool` — generic pool usable by any `IGraphProvider`
  - `ResultTransformer` — normalizes raw Gremlin output into plain objects safe for IPC transfer

### `apps/electron`
- **What:** Electron main process. Owns the window, IPC wiring, and app lifecycle.
- **Rule:** No business logic. Delegates everything to `@graph-client/core`.
- **Key concept:** `ipc/registry.ts` is the single file that binds IPC channels to handler functions.

### `apps/renderer`
- **What:** React UI. Canvas graph visualization. Query editor and results panel.
- **Rule:** Only talks to the main process via typed IPC wrappers in `api/`. Never imports from `packages/core` directly.
- **Why:** Enforces the IPC boundary — the renderer can't accidentally call Node.js APIs.

---

## Data Flow: Query Execution

```
User types query in QueryPanel
  │
  ▼
api/graphApi.ts  →  window.graphClient.query({ id, query, dialect })
  │                 (contextBridge call)
  │
  ▼  [IPC: graph:query]
apps/electron/ipc/handlers/queryHandlers.ts
  │
  ▼
packages/core/connection/ConnectionManager.executeQuery()
  │  (acquires slot from pool if pooled)
  ▼
packages/core/graph/implementations/<Provider>.executeQuery()
  │  (validates dialect, applies retry + timeout)
  ▼
packages/db-clients/<driver>.submit(rawQuery)
  │
  ▼  [raw ResultSet]
packages/core/graph/implementations/<Provider>  →  QueryResult<T>
  │
  ▼  [IPC response]
apps/renderer/api/graphApi.ts  →  state/  →  ResultsPanel
```

---

## IPC Contract

Every IPC channel is defined in `packages/shared/ipc/channels.ts`.
Every request/response shape is in `packages/shared/ipc/contracts.ts`.

Never use raw string literals for channel names. Always import `IpcChannels`.

```typescript
// ✅ correct
import { IpcChannels } from '@graph-client/shared';
ipcMain.handle(IpcChannels.GRAPH_QUERY, handler);

// ❌ wrong — breaks silently on rename
ipcMain.handle('graph:query', handler);
```

---

## Adding a New Database Provider

See [docs/adding-a-provider.md](docs/adding-a-provider.md).

---

## Adding a New Query Dialect

See [docs/adding-a-dialect.md](docs/adding-a-dialect.md).

---

## Removed: the original `server/` implementation

Earlier revisions of this document described a `server/` directory holding the
original JavaScript implementation, to be migrated into `packages/core/`
incrementally. That migration is complete and **no `server/` or `client/`
directory exists** — everything lives in `apps/` and `packages/`.

