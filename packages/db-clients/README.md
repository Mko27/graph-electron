# @graph-client/db-clients

Thin, transport-only wrappers over graph database npm drivers.

**Rule:** These clients ONLY connect, disconnect, and send raw bytes.
No retry logic. No result transformation. No schema introspection.
All of that belongs in `@graph-client/core`.

## Why a separate package

1. **Upgrade isolation** — When `neo4j-driver` releases a breaking change, only this package needs updating.
2. **Testability** — Core providers can be tested by mocking these clients instead of real databases.
3. **Clarity** — Makes the transport/protocol layer explicit and auditable.

## Clients

### `NeptuneGremlinClient`
```typescript
import { NeptuneGremlinClient } from '@graph-client/db-clients';

const client = new NeptuneGremlinClient({ host, port, ssl: true, useIamAuth: true });
const url = await client.open();
const resultSet = await client.submit('g.V().limit(10)', {});
client.close();
```

### `Neo4jBoltClient`
```typescript
import { Neo4jBoltClient } from '@graph-client/db-clients';
// Requires: npm install neo4j-driver

const client = new Neo4jBoltClient({ host, port, ssl: false, username: 'neo4j', password: 'password' });
await client.open();
const session = client.session('neo4j');
// Use neo4j-driver session API directly
await client.close();
```

### `ArangoHttpClient`
```typescript
import { ArangoHttpClient } from '@graph-client/db-clients';
// Requires: npm install arangojs

const client = new ArangoHttpClient({ host, port, ssl: false, database: 'mydb' });
await client.open();
const rows = await client.query('FOR v IN myCollection RETURN v');
client.close();
```

## Build

```bash
npm run build       # tsc → dist/
npm run typecheck   # tsc --noEmit
```
