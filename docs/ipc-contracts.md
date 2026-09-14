# IPC API Reference

All IPC contracts are typed in `packages/shared/src/ipc/contracts.ts`.
Channel names are in `packages/shared/src/ipc/channels.ts`.

---

## Multi-Provider Channels (`graph:*`)

### `graph:providers`
Returns the list of available database providers and query dialects.

**Request:** _(no payload)_

**Response:**
```typescript
{
  success: boolean;
  providers: Array<{ dbType: string; displayName: string; description: string }>;
  dialects: Array<{ name: string; displayName: string; fileExtension: string }>;
  message?: string; // present when success is false
}
```

---

### `graph:connect`
Creates and connects a new provider instance.

**Request:**
```typescript
{ config: ProviderConnectionDto }
```

`ProviderConnectionDto` fields:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | ✅ | Stable ID — used in all subsequent calls |
| `name` | string | ✅ | Display name |
| `dbType` | string | ✅ | `neptune`, `neo4j`, `janusgraph`, `arangodb`, `cosmosdb`, `orientdb`, `tigergraph`, `nebula`, `tinkerpop` |
| `dialect` | string | ✅ | `gremlin`, `cypher`, `opencypher`, `ngql`, `graphql`, `sparql`, `gsql` |
| `host` | string | ✅ | Hostname or IP |
| `port` | number | ✅ | — |
| `ssl` | boolean | ✅ | Enables WSS/HTTPS and (for Neptune) IAM auth |
| `username` | string | — | Neo4j, OrientDB, NebulaGraph |
| `password` | string | — | Neo4j, OrientDB, NebulaGraph |
| `token` | string | — | TigerGraph bearer token |
| `primaryKey` | string | — | Azure Cosmos DB primary key |
| `useIamAuth` | boolean | — | Neptune: sign with SigV4 (default true when ssl=true) |
| `database` | string | — | Neo4j, ArangoDB, CosmosDB database name |
| `collection` | string | — | CosmosDB container/collection |
| `graphName` | string | — | TigerGraph graph name |
| `space` | string | — | NebulaGraph space name |
| `poolMin` | number | — | Connection pool minimum (default 1) |
| `poolMax` | number | — | Connection pool maximum (default 1 = no pool) |
| `connectionTimeoutMs` | number | — | Default 15000 |
| `queryTimeoutMs` | number | — | Default 30000 |
| `maxRetries` | number | — | Default 3 |
| `region` | string | — | Neptune AWS region (auto-detected from hostname if omitted) |
| `traversalSource` | string | — | Gremlin traversal source (default `g`) |

**Response:**
```typescript
{ success: boolean; url?: string; message?: string }
```

---

### `graph:disconnect`
Disconnects and removes an active connection.

**Request:** `{ id: string }`

**Response:** `{ success: boolean; message?: string }`

---

### `graph:health`
Checks the health of an active connection.

**Request:** `{ id: string }`

**Response:**
```typescript
{
  connected: boolean;
  latencyMs?: number;
  lastPing?: string;         // ISO date string
  poolSize?: number;
  activeConnections?: number;
  idleConnections?: number;
  error?: string;
}
```

---

### `graph:query`
Executes a query through an active connection.

**Request:**
```typescript
{
  id: string;
  query: string;
  dialect?: string;          // overrides the connection's default dialect
  parameters?: Record<string, unknown>;
}
```

**Response:**
```typescript
{
  success: boolean;
  data?: unknown[];
  duration?: number;          // milliseconds
  count?: number;
  message?: string;
  metadata?: {
    requestId?: string;
    warnings?: string[];
    profile?: { planningTimeMs?: number; executionTimeMs?: number };
  };
}
```

---

### `graph:schema`
Introspects the schema of the connected graph.

**Request:** `{ id: string }`

**Response:**
```typescript
{
  success: boolean;
  vertexLabels?: Array<{
    label: string;
    properties: Array<{ name: string; dataType: string; cardinality?: string }>;
    count?: number;
  }>;
  edgeLabels?: Array<{
    label: string;
    properties: Array<{ name: string; dataType: string }>;
    fromLabels?: string[];
    toLabels?: string[];
    count?: number;
  }>;
  propertyKeys?: Array<{ name: string; dataType: string }>;
  message?: string;
}
```

---

### `graph:list-graphs`
Lists the graphs/spaces/databases available in the connection.

**Request:** `{ id: string }`

**Response:** `{ success: boolean; graphs?: string[]; message?: string }`

---

### `graph:connections`
Lists all currently active connections.

**Request:** _(no payload)_

**Response:**
```typescript
{
  success: boolean;
  connections: Array<{ id: string; dbType: string; dialect: string; host: string }>;
}
```

---

## Legacy Channel Names (`connection:*`, `execute-query`, `get-schema`)

These names exist in `IpcChannels` for backwards compatibility, but **only
`connection:remove` has a handler**. The rest are unregistered: invoking them
throws `No handler registered for '<channel>'`. This table used to list all six
as available.

| Channel | Status |
|---------|--------|
| `connection:remove` | **Registered** — disconnects and forgets the stored credential |
| `connection:connect` | Not registered — use `graph:connect` |
| `connection:disconnect` | Not registered — use `graph:disconnect` |
| `connection:status` | Not registered — use `graph:health` |
| `execute-query` | Not registered — use `graph:query` |
| `get-schema` | Not registered — use `graph:schema` |

The preload bridge only forwards channels present in `IpcChannels`, so an
unregistered name fails in the main process rather than being silently dropped.

---

## DynamoDB Channels (`dynamo:*`)

| Channel | Purpose |
|---------|---------|
| `dynamo-configure` | Set region, table, endpoint |
| `dynamo-get-config` | Get current DynamoDB config |
| `dynamo-fetch-item` | Fetch a single item by ID |
