# Graph Client

Multi-provider graph database desktop application.

Connect to Amazon Neptune, Neo4j, JanusGraph, ArangoDB, Azure Cosmos DB, OrientDB, TigerGraph,
NebulaGraph, or any TinkerPop-compatible database from a single UI.

## Supported Databases

| Database | Status | Dialects |
|----------|--------|---------|
| Amazon Neptune | ✅ Full | Gremlin, openCypher |
| Neo4j | ✅ Full | Cypher |
| JanusGraph | ⚙ Stub | Gremlin |
| ArangoDB | ⚙ Stub | GraphQL, Gremlin |
| Azure Cosmos DB Gremlin | ⚙ Stub | Gremlin |
| OrientDB | ⚙ Stub | Gremlin, GraphQL |
| TigerGraph | ⚙ Stub | GSQL, GraphQL |
| NebulaGraph | ⚙ Stub | nGQL |
| Apache TinkerPop | ⚙ Stub | Gremlin |

✅ Full = production ready  
⚙ Stub = correct interface, needs driver-specific testing

## Quick Start

Requires Node 20.11+ (see `.nvmrc`; `nvm use` picks it up).

```bash
npm install       # must run Electron's postinstall — see the note below
npm start         # compiles, bundles (dev mode) and launches
```

`npm start` runs the compile and bundle steps itself, so those are only needed
separately when you want to inspect their output:

```bash
npm run compile   # compile TypeScript packages
npm run bundle    # bundle the renderer (production, minified)
npm run bundle:dev
```

Verifying the checkout needs no build step at all:

```bash
npm run typecheck
npm test
```

**If `npm start` fails with a missing Electron framework**, the install skipped
Electron's postinstall, which is what downloads the ~90MB runtime, leaving the
package a stub. The repo's `.npmrc` sets `ignore-scripts=false` to prevent
this; if your npm config overrides it, run:

```bash
npm rebuild electron        # or: npm install --foreground-scripts
```

See [ONBOARDING.md](ONBOARDING.md) for detailed setup.

## Documentation

| Document | Purpose |
|----------|---------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Package structure, data flow, design decisions |
| [ONBOARDING.md](ONBOARDING.md) | Getting started, repo map, common tasks |
| [docs/adding-a-provider.md](docs/adding-a-provider.md) | How to add a new database |
| [docs/adding-a-dialect.md](docs/adding-a-dialect.md) | How to add a new query language |
| [docs/ipc-contracts.md](docs/ipc-contracts.md) | Full IPC API reference |
| [docs/provider-capabilities.md](docs/provider-capabilities.md) | Capability matrix |
| [packages/core/README.md](packages/core/README.md) | Core package reference |
| [packages/shared/README.md](packages/shared/README.md) | Shared types reference |
| [packages/db-clients/README.md](packages/db-clients/README.md) | DB client wrappers — **currently unused**, superseded by `packages/core` providers |

## Architecture (30-second version)

```
apps/renderer  ──IPC──►  apps/electron  ──►  packages/core  ──►  database drivers
   (React)                 (Node.js)          (Business logic)      (Driver wrappers)
                                │
                         packages/shared
                         (Shared types)
```

- The renderer **only** talks to the main process via typed IPC.
- The main process **delegates** all business logic to `@graph-client/core`.
- `@graph-client/core` is platform-agnostic and testable without Electron.
- `@graph-client/shared` is the single source of truth for IPC contracts.

## Migration Status

The `server/` and `client/` directories contain the original JavaScript implementation.
New code goes into `apps/` and `packages/`. Legacy code is actively being migrated.

See [ARCHITECTURE.md#legacy-code](ARCHITECTURE.md#legacy-code-server) for details.
