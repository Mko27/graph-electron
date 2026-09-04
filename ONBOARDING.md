# Onboarding Guide

Welcome to Graph Client. This guide gets you from zero to a running local build in under 15 minutes
and explains where things live and why.

---

## Prerequisites

| Tool | Min version | Notes |
|------|-------------|-------|
| Node.js | 18 LTS | Electron 28 requires ≥ 18 |
| npm | 9 | Workspace support required |
| Git | any | — |

Optional (for specific database testing):
- Docker (run JanusGraph / Neo4j locally)
- AWS CLI configured (for Neptune IAM auth)

---

## Quick Start

```bash
# 1. Clone
git clone <repo-url>
cd graph-client

# 2. Install all workspace dependencies at once
npm install

# 3. Compile TypeScript packages (shared → core order matters)
npm run compile

# 4. Bundle the React renderer
npm run bundle

# 5. Launch the Electron app
npm start
```

That's it. The app opens on the multi-provider UI; the `graph:*` IPC channels
are wired in `apps/electron/src/ipc/registry.ts`.

If `npm start` fails on a missing Electron framework, the install skipped
Electron's postinstall (which downloads the runtime). Run `npm rebuild electron`.

---

## Repository Map

```
graph-client/
│
├── apps/                          # Platform-specific entry points
│   ├── electron/                  # Electron main process (TypeScript)
│   │   └── src/
│   │       ├── ipc/               # IPC handler registration (START HERE)
│   │       │   ├── registry.ts    ← binds all channels to handlers
│   │       │   └── handlers/      ← one file per concern
│   │       ├── windows/           # BrowserWindow creation, preload
│   │       └── services/          # Bridges to @graph-client/core
│   │
│   └── renderer/                  # React UI (JSX/TSX)
│       └── src/
│           ├── components/        # Reusable UI components
│           ├── pages/             # Full-page views
│           ├── hooks/             # Custom React hooks
│           ├── api/               # IPC wrappers (typed, no raw strings)
│           └── state/             # Global state (React Context / Zustand)
│
├── packages/                      # Shared business logic
│   ├── core/                      # ← MOST CODE LIVES HERE
│   │   └── src/
│   │       ├── graph/             # Provider system (the big one)
│   │       │   ├── types/         # Interfaces: IGraphProvider, IQueryDialect, etc.
│   │       │   ├── factory/       # ConnectionFactory (entry point)
│   │       │   ├── registry/      # ProviderRegistry, DialectRegistry
│   │       │   ├── pool/          # ConnectionPool
│   │       │   ├── dialects/      # Gremlin, Cypher, openCypher, nGQL, SPARQL
│   │       │   └── implementations/ # One folder per database
│   │       │       ├── neptune/   # ✅ Full implementation
│   │       │       ├── neo4j/     # ✅ Full implementation
│   │       │       ├── janusgraph/ # ⚙ Production stub
│   │       │       ├── arangodb/  # ⚙ Production stub
│   │       │       ├── cosmosdb/  # ⚙ Production stub
│   │       │       ├── orientdb/  # ⚙ Production stub
│   │       │       ├── tigergraph/ # ⚙ Production stub
│   │       │       ├── nebula/    # ⚙ Production stub
│   │       │       └── tinkerpop/ # ⚙ Production stub
│   │       ├── connection/        # ConnectionManager (owns all active connections)
│   │       ├── query-engine/      # ResultTransformer (Gremlin result normalization)
│   │       ├── auth/              # Auth strategies (IAM, Basic, Token)
│   │       ├── logging/           # Logger type + consoleLogger / noopLogger
│   │       └── utils/             # withRetry, withTimeout
│   │
│   ├── shared/                    # Zero-dependency types shared by both sides
│   │   └── src/
│   │       ├── ipc/channels.ts    ← ALL IPC channel names (one source of truth)
│   │       ├── ipc/contracts.ts   ← request/response types for every channel
│   │       └── constants/         ← default ports, display labels
│   │
│   └── db-clients/                # Thin driver wrappers — UNUSED, nothing imports it
│       └── src/                   #   (superseded by packages/core providers)
│           ├── neptune/           # NeptuneGremlinClient
│           ├── neo4j/             # Neo4jBoltClient
│           └── arango/            # ArangoHttpClient
│
├── .github/workflows/ci.yml       ← typecheck + tests + build on every push/PR
│
├── ARCHITECTURE.md                ← Big picture
├── ONBOARDING.md                  ← This file
├── tsconfig.base.json             ← Shared TS settings (all packages extend this)
└── docs/
    ├── adding-a-provider.md       ← Step-by-step guide for new DB adapters
    ├── adding-a-dialect.md        ← Step-by-step guide for new query dialects
    ├── ipc-contracts.md           ← Full IPC API reference
    └── provider-capabilities.md   ← Capability matrix per provider
```

---

## Mental Model: The Three Boundaries

Understanding these three boundaries explains 90% of the codebase decisions:

### 1. The IPC Boundary (apps/renderer ↔ apps/electron)
The renderer **cannot** import from `packages/core` or call Node.js APIs.
It only sends typed IPC messages and receives typed responses.
All IPC shapes are defined in `packages/shared/ipc/contracts.ts`.

### 2. The Provider Boundary (apps/electron ↔ packages/core)
The Electron app **delegates** all business logic to `packages/core`.
It does not know the difference between Neptune and Neo4j — it just calls
`connectionManager.executeQuery()`.

### 3. The Transport Boundary (packages/core ↔ packages/db-clients)
Core providers use `packages/db-clients` for raw connections but keep
all retry, timeout, schema introspection, and result transformation in core.
This makes core providers testable without a real database.

---

## Common Tasks

### Run type checking (all packages)
```bash
npm run typecheck
```

### Compile TypeScript only
```bash
npm run compile
```

### Add a new graph database provider
```bash
# 1. Read the guide
cat docs/adding-a-provider.md

# 2. Create the implementation
mkdir packages/core/src/graph/implementations/mygraph
# Follow the pattern from neptune/ or neo4j/

# 3. Register in the factory
# packages/core/src/graph/factory/ConnectionFactory.ts
```

### Add a new IPC channel
```bash
# 1. Add the channel name
# packages/shared/src/ipc/channels.ts

# 2. Add request/response types
# packages/shared/src/ipc/contracts.ts

# 3. Write the handler
# apps/electron/src/ipc/handlers/<concern>Handlers.ts

# 4. Register in the registry
# apps/electron/src/ipc/registry.ts

# 5. Add the client wrapper
# apps/renderer/src/api/graphApi.ts (or appropriate api file)
```

### Run the app against a local Neo4j
```bash
# Start Neo4j in Docker
docker run --name neo4j -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/password \
  neo4j:5

# Connect in the app
# dbType: neo4j, dialect: cypher, host: localhost, port: 7687
# username: neo4j, password: password
```

### Run the app against a local TinkerPop server
```bash
docker run -it --rm -p 8182:8182 tinkerpop/gremlin-server
# dbType: tinkerpop, dialect: gremlin, host: localhost, port: 8182
```

---

## Key Types Cheat Sheet

```typescript
// From @graph-client/shared
import { IpcChannels } from '@graph-client/shared';        // channel names
import type { GraphQueryRequest } from '@graph-client/shared'; // IPC shapes
import { DEFAULT_PORTS } from '@graph-client/shared';       // default port per dbType

// From @graph-client/core
import { ConnectionManager } from '@graph-client/core';
import { ConnectionFactory } from '@graph-client/core';
import type { IGraphProvider } from '@graph-client/core';  // provider interface
import type { ProviderConnectionConfig } from '@graph-client/core'; // discriminated union
import type { QueryResult } from '@graph-client/core';     // generic result
import type { ProviderCapabilities } from '@graph-client/core'; // capability matrix
```

---

## Gotchas

**"Provider system not compiled"** — Run `npm run compile`, which builds
`packages/shared`, `packages/core` and `apps/electron` into their `dist/`
directories before `apps/electron/dist/main.js` can load them. Note that
`npm run typecheck` and `npm test` do NOT need this: both resolve the workspace
packages to their sources.

**"No provider registered for database type X"** — `ConnectionFactory` must be instantiated
(which triggers `bootstrap()`) before calling `ProviderRegistry.getInstance().resolve()` directly.

**Electron IPC serialization** — All values sent over IPC go through structured clone.
Class instances, Maps, Sets, and functions are stripped. Always ensure results are plain
objects before returning from an IPC handler. Use `ResultTransformer.ensureSerializable()`.

**Optional driver dependencies** — `neo4j-driver` and `arangojs` are in `peerDependencies`
(optional). Their providers will throw a helpful "not installed" error on first `connect()`.
Install them as needed: `npm install neo4j-driver arangojs`.
