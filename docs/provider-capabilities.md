# Provider Capability Matrix

Use `provider.capabilities` at runtime to check what a given connection supports
before presenting features in the UI.

```typescript
const caps = provider.capabilities;
if (caps.supportsTransactions) { /* show Begin Transaction button */ }
if (caps.supportsSchema) { /* show Schema Explorer */ }
```

---

## Matrix

| Capability | Neptune | Neo4j | JanusGraph | ArangoDB | CosmosDB | OrientDB | TigerGraph | NebulaGraph | TinkerPop |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `supportsTransactions` | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| `supportsSchema` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ |
| `supportsMultiGraph` | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| `supportsStreaming` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `supportsGremlin` | ✅ | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ |
| `supportsCypher` | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `supportsOpenCypher` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `supportsNGQL` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| `supportsSPARQL` | ✅* | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `supportsGraphQL` | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| `supportsBulkLoad` | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| `supportsPropertyGraph` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `supportsRDFGraph` | ✅* | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `maxConnectionsPerPool` | 5 | 10 | 5 | 10 | 3 | 5 | 5 | 5 | 5 |

\* Neptune supports SPARQL and RDF via Neptune Analytics / RDF mode (separate endpoint).

---

## DIALECT_COMPATIBILITY

Which dialects can be selected per database type at connection time:

| DB Type | Allowed Dialects |
|---------|-----------------|
| neptune | `gremlin`, `opencypher` |
| janusgraph | `gremlin` |
| neo4j | `cypher` |
| arangodb | `graphql`, `gremlin` |
| cosmosdb | `gremlin` |
| orientdb | `gremlin`, `graphql` |
| tigergraph | `gsql`, `graphql` |
| nebula | `ngql` |
| tinkerpop | `gremlin` |

The `ConnectionFactory.validateConfig()` method enforces this at connection creation time.
The `BaseProvider.validateDialect()` method re-checks it at query execution time.

---

## Capability Negotiation in the UI

Recommended pattern for feature gating in the renderer:

```typescript
// api/graphApi.ts
const capabilities = await window.graphClient.getCapabilities(connectionId);

// state/connectionStore.ts
if (capabilities.supportsTransactions) {
  showTransactionControls();
}

if (capabilities.supportsSchema) {
  enableSchemaExplorer();
}

if (!capabilities.supportsMultiGraph) {
  hideGraphSwitcher();
}
```

The `graph:providers` IPC channel returns capability information for the UI
before a connection is established (for showing relevant UI during connection setup).
After connecting, use `graph:health` which also returns pool state.
