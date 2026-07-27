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

```bash
npm install
npm run compile   # compile TypeScript packages
npm run bundle    # bundle React renderer
npm start         # launch app
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
| [packages/db-clients/README.md](packages/db-clients/README.md) | DB client wrappers reference |

## Architecture (30-second version)

```
apps/renderer  ──IPC──►  apps/electron  ──►  packages/core  ──►  packages/db-clients
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
