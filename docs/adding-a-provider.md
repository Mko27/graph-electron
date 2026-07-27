# Adding a New Graph Database Provider

This guide walks through the exact steps to add a new database to the provider system.
Estimated time: 30–60 minutes depending on how well-documented the target DB's driver is.

---

## Step 1 — Decide where the driver lives

Ask: does the database have an official npm package?

| Situation | Where to put the connection logic |
|-----------|-----------------------------------|
| Official npm driver exists | Create a thin client in `packages/db-clients/src/<dbname>/` and use it from the provider |
| Uses Gremlin WebSocket | Reuse `gremlin` (already installed). Extend `TinkerPopProvider` or create a new class that inherits the same pattern |
| REST-only API | HTTP calls go directly in the provider implementation |

---

## Step 2 — Add the database type

**File:** `packages/core/src/graph/types/IConnectionConfig.ts`

```typescript
// 1. Add to the DatabaseType union
export type DatabaseType =
  | 'neptune'
  | 'neo4j'
  // ... existing types ...
  | 'mydb';           // ← add this

// 2. Define the config interface (discriminated by dbType)
export interface MyDbConnectionConfig extends BaseConnectionConfig {
  dbType: 'mydb';
  dialect: 'gremlin';   // or whichever dialects MyDB supports
  username: string;
  password: string;
  graphName?: string;
}

// 3. Add to the ProviderConnectionConfig union
export type ProviderConnectionConfig =
  | NeptuneConnectionConfig
  // ...
  | MyDbConnectionConfig;   // ← add this

// 4. Add compatible dialects
export const DIALECT_COMPATIBILITY: Record<DatabaseType, QueryDialect[]> = {
  // ...
  mydb: ['gremlin'],         // ← add this
};
```

---

## Step 3 — Create the provider implementation

**Create:** `packages/core/src/graph/implementations/mydb/MyDbProvider.ts`

```typescript
import type { ProviderCapabilities } from '../../types/ICapabilities';
import type { MyDbConnectionConfig, QueryDialect } from '../../types/IConnectionConfig';
import type { ConnectionState, SchemaInfo } from '../../types/IGraphProvider';
import type { QueryResult } from '../../types/IQueryResult';
import { BaseProvider, type Logger } from '../BaseProvider';

export class MyDbProvider extends BaseProvider {
  readonly capabilities: ProviderCapabilities = {
    supportsTransactions: false,      // fill in accurately
    supportsSchema: true,
    supportsMultiGraph: false,
    supportsStreaming: false,
    supportsGremlin: true,
    supportsCypher: false,
    supportsOpenCypher: false,
    supportsNGQL: false,
    supportsSPARQL: false,
    supportsGraphQL: false,
    supportsBulkLoad: false,
    supportsPropertyGraph: true,
    supportsRDFGraph: false,
    maxConnectionsPerPool: 5,
  };

  private client: unknown = null;

  constructor(
    id: string,
    public override readonly config: MyDbConnectionConfig,
    logger?: Logger,
  ) {
    super(id, config, logger);
  }

  async connect(): Promise<void> {
    // Open connection using your driver or db-clients wrapper
    this.log('info', `Connecting to MyDb at ${this.config.host}:${this.config.port}`);
    // ... driver-specific logic ...
    this.log('info', 'Connected to MyDb');
  }

  async disconnect(): Promise<void> {
    // Close the connection
    this.client = null;
  }

  async healthCheck(): Promise<ConnectionState> {
    const start = Date.now();
    try {
      // Send a lightweight ping query
      return { connected: true, latencyMs: Date.now() - start, lastPing: new Date() };
    } catch (err) {
      return { connected: false, error: (err as Error).message };
    }
  }

  async executeQuery<T = unknown>(
    query: string,
    dialect: QueryDialect,
    parameters: Record<string, unknown> = {},
  ): Promise<QueryResult<T>> {
    this.validateDialect(dialect);        // inherited from BaseProvider
    if (!this.client) throw new Error('Not connected to MyDb');
    const start = Date.now();

    return this.withRetry(async () => {   // inherited — handles exp. backoff
      // Execute the query
      const data: T[] = [];
      return { success: true, data, duration: Date.now() - start, count: data.length };
    }, 'MyDb query');
  }

  async introspectSchema(): Promise<SchemaInfo> {
    // Return vertex/edge labels and property keys if the DB supports it
    return { vertexLabels: [], edgeLabels: [], propertyKeys: [] };
  }

  async listGraphs(): Promise<string[]> {
    return [this.config.host];
  }
}
```

**Create:** `packages/core/src/graph/implementations/mydb/index.ts`

```typescript
export { MyDbProvider } from './MyDbProvider';
```

---

## Step 4 — Register in the factory

**File:** `packages/core/src/graph/factory/ConnectionFactory.ts`

```typescript
// 1. Import the provider
import { MyDbProvider } from '../implementations/mydb/MyDbProvider';

// 2. Add to PROVIDER_CATALOG
const PROVIDER_CATALOG: Record<DatabaseType, ProviderMeta> = {
  // ...existing entries...
  mydb: {
    Ctor: MyDbProvider,
    displayName: 'MyDb',
    description: 'Short description for the connection dialog',
  },
};
```

That's it. The registry bootstraps on first `ConnectionFactory` instantiation.

---

## Step 5 — Add shared constants (optional but recommended)

**File:** `packages/shared/src/constants/index.ts`

```typescript
export const DB_TYPE_LABELS: Record<string, string> = {
  // ...
  mydb: 'My Database',   // display name in the UI
};

export const DEFAULT_PORTS: Record<string, number> = {
  // ...
  mydb: 1234,   // default port
};
```

---

## Step 6 — Add optional npm driver to package.json

If the provider requires an npm package that isn't already installed:

```bash
# If it's required for the provider to work at all:
npm install my-db-driver

# If it's optional (the provider throws a helpful error if not installed):
# Add to peerDependencies in packages/core/package.json
```

For optional drivers, wrap the require in a try/catch as shown in Neo4jProvider:

```typescript
let myDbDriver: typeof import('my-db-driver') | null = null;
try {
  myDbDriver = require('my-db-driver');
} catch { /* optional */ }

// In connect():
if (!myDbDriver) {
  throw new Error('my-db-driver is not installed. Run: npm install my-db-driver');
}
```

---

## Step 7 — Test

```typescript
import { ConnectionFactory } from '@graph-client/core';
import type { MyDbConnectionConfig } from '@graph-client/core';

const factory = new ConnectionFactory();

const config: MyDbConnectionConfig = {
  id: 'test-mydb',
  name: 'Local MyDb',
  dbType: 'mydb',
  dialect: 'gremlin',
  host: 'localhost',
  port: 1234,
  ssl: false,
  username: 'admin',
  password: 'secret',
};

const provider = factory.createProvider(config);
await provider.connect();

const result = await provider.executeQuery('g.V().limit(10)', 'gremlin');
console.log(result.data);

await provider.disconnect();
```

---

## Checklist

- [ ] `DatabaseType` union updated in `IConnectionConfig.ts`
- [ ] Config interface added and added to `ProviderConnectionConfig` union
- [ ] `DIALECT_COMPATIBILITY` entry added
- [ ] `packages/core/src/graph/implementations/<mydb>/MyDbProvider.ts` created
- [ ] `packages/core/src/graph/implementations/<mydb>/index.ts` created
- [ ] Entry added to `PROVIDER_CATALOG` in `ConnectionFactory.ts`
- [ ] `DB_TYPE_LABELS` and `DEFAULT_PORTS` updated in `packages/shared`
- [ ] Optional driver wrapped in try/catch if not always installed
- [ ] Manual test: connect → query → disconnect
