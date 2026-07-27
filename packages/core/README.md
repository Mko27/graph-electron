# @graph-client/core

All graph database business logic. No Electron APIs. No IPC. Platform-agnostic.

## What's inside

```
src/
├── graph/
│   ├── types/            ← Interfaces (IGraphProvider, IQueryDialect, ProviderCapabilities)
│   ├── factory/          ← ConnectionFactory — single entry point
│   ├── registry/         ← ProviderRegistry, DialectRegistry (singletons)
│   ├── pool/             ← ConnectionPool
│   ├── dialects/         ← Gremlin, Cypher, openCypher, nGQL, SPARQL, GSQL
│   └── implementations/  ← One folder per database
│       ├── neptune/      ← Full: Gremlin WS + SigV4 IAM + openCypher HTTP
│       ├── neo4j/        ← Full: bolt driver, transactions, multi-db
│       ├── janusgraph/   ← Stub: Gremlin WS
│       ├── arangodb/     ← Stub: arangojs driver
│       ├── cosmosdb/     ← Stub: Gremlin WS + SASL auth
│       ├── orientdb/     ← Stub: Gremlin WS + auth
│       ├── tigergraph/   ← Stub: REST++ API
│       ├── nebula/       ← Stub: nebula-javascript
│       └── tinkerpop/    ← Generic TinkerPop Gremlin WS
├── connection/           ← ConnectionManager (owns all active connections)
├── query-engine/         ← ResultTransformer (Gremlin result normalization)
├── auth/                 ← Auth strategies (IAM, Basic, Token)
├── logging/              ← Logger type + consoleLogger / noopLogger
└── utils/                ← withRetry, withTimeout
```

## Key concepts

**`IGraphProvider`** — the interface every database adapter implements.
All five methods (`connect`, `disconnect`, `healthCheck`, `executeQuery`, `introspectSchema`)
must be implemented. Transactions and streaming are optional.

**`ConnectionFactory`** — instantiate once, use everywhere.
It bootstraps `ProviderRegistry` and `DialectRegistry` on first use (lazy, idempotent).

```typescript
const factory = new ConnectionFactory();
const provider = factory.createProvider(config, logger);
await provider.connect();
const result = await provider.executeQuery('g.V().limit(10)', 'gremlin');
await provider.disconnect();
```

**`ProviderRegistry`** — plugin point for new databases.
```typescript
ProviderRegistry.getInstance().register('mydb', (id, cfg, log) => new MyDbProvider(id, cfg, log), {
  displayName: 'My Database',
  description: 'Custom graph database',
});
```

**`ConnectionPool`** — wrap any provider factory.
```typescript
const pool = new ConnectionPool(() => factory.createProvider(config, logger), { min: 1, max: 5 });
await pool.initialize();
const provider = await pool.acquire();
try {
  await provider.executeQuery(query, 'gremlin');
} finally {
  pool.release(provider);
}
```

## Adding a provider

See [../../docs/adding-a-provider.md](../../docs/adding-a-provider.md).

## Build

```bash
npm run build       # tsc → dist/
npm run typecheck   # tsc --noEmit
```
