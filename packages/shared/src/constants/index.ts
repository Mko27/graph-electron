export const DB_TYPE_LABELS: Record<string, string> = {
  neptune: 'Amazon Neptune',
  neo4j: 'Neo4j',
  janusgraph: 'JanusGraph',
  arangodb: 'ArangoDB',
  cosmosdb: 'Azure Cosmos DB Gremlin',
  orientdb: 'OrientDB',
  tigergraph: 'TigerGraph',
  nebula: 'NebulaGraph',
  tinkerpop: 'Apache TinkerPop',
};

/**
 * Which query dialects each database type supports.
 * Duplicated from @graph-client/core so the renderer can import it without
 * pulling in the full core package (which has Electron-only dependencies).
 */
export const DIALECT_COMPATIBILITY: Record<string, string[]> = {
  neptune:     ['gremlin', 'opencypher'],
  janusgraph:  ['gremlin'],
  neo4j:       ['cypher'],
  arangodb:    ['graphql', 'gremlin'],
  cosmosdb:    ['gremlin'],
  orientdb:    ['gremlin', 'graphql'],
  tigergraph:  ['gsql', 'graphql'],
  nebula:      ['ngql'],
  tinkerpop:   ['gremlin'],
};

/**
 * Capability flags for each provider — used by the UI to gate features
 * (schema explorer, transaction panel, etc.) without an extra IPC round-trip.
 */
export interface UICapabilities {
  supportsSchema: boolean;
  supportsTransactions: boolean;
  supportsMultiGraph: boolean;
  supportsStreaming: boolean;
}

export const PROVIDER_CAPABILITIES: Record<string, UICapabilities> = {
  neptune:    { supportsSchema: true,  supportsTransactions: false, supportsMultiGraph: false, supportsStreaming: false },
  neo4j:      { supportsSchema: true,  supportsTransactions: true,  supportsMultiGraph: true,  supportsStreaming: true  },
  janusgraph: { supportsSchema: true,  supportsTransactions: false, supportsMultiGraph: false, supportsStreaming: false },
  arangodb:   { supportsSchema: false, supportsTransactions: true,  supportsMultiGraph: true,  supportsStreaming: false },
  cosmosdb:   { supportsSchema: false, supportsTransactions: false, supportsMultiGraph: false, supportsStreaming: false },
  orientdb:   { supportsSchema: false, supportsTransactions: true,  supportsMultiGraph: true,  supportsStreaming: false },
  tigergraph: { supportsSchema: true,  supportsTransactions: false, supportsMultiGraph: true,  supportsStreaming: false },
  nebula:     { supportsSchema: false, supportsTransactions: false, supportsMultiGraph: true,  supportsStreaming: false },
  tinkerpop:  { supportsSchema: false, supportsTransactions: false, supportsMultiGraph: false, supportsStreaming: false },
};

export const DIALECT_LABELS: Record<string, string> = {
  gremlin: 'Gremlin',
  cypher: 'Cypher',
  opencypher: 'openCypher',
  ngql: 'nGQL',
  graphql: 'GraphQL',
  sparql: 'SPARQL',
  gsql: 'GSQL',
};

export const DEFAULT_PORTS: Record<string, number> = {
  neptune: 8182,
  janusgraph: 8182,
  neo4j: 7687,
  arangodb: 8529,
  cosmosdb: 443,
  orientdb: 8182,
  tigergraph: 9000,
  nebula: 9669,
  tinkerpop: 8182,
};

export const DEFAULT_QUERY_TIMEOUT_MS = 30_000;
export const DEFAULT_CONNECTION_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_POOL_MIN = 1;
export const DEFAULT_POOL_MAX = 5;

/**
 * DynamoDB environment presets.
 *
 * Each environment points at its own table (and optionally its own region,
 * endpoint and AWS profile), so switching environment re-points the enrichment
 * lookups without retyping the connection details.
 *
 * These are seed defaults only — the values are editable in the UI and the
 * edited set is persisted with the workspace, so a wrong default is a one-time
 * correction rather than a code change.
 */
export interface DynamoEnvironmentConfig {
  label: string;
  region: string;
  tableName: string;
  /** Empty string = real AWS (no custom endpoint override). */
  endpoint: string;
  /** Named AWS profile (incl. SSO profiles) used to resolve credentials. */
  profile?: string;
}

export const DYNAMO_ENVIRONMENT_ORDER = ['local', 'stage', 'plive'] as const;

export type DynamoEnvironmentId = (typeof DYNAMO_ENVIRONMENT_ORDER)[number];

export const DYNAMO_ENVIRONMENTS: Record<string, DynamoEnvironmentConfig> = {
  local: {
    label: 'Local',
    region: 'us-east-1',
    tableName: 'development_blocks',
    endpoint: 'http://localhost:8000',
  },
  stage: {
    label: 'Stage',
    region: 'us-east-1',
    tableName: 'stage_blocks',
    endpoint: '',
  },
  plive: {
    label: 'Plive',
    region: 'us-east-1',
    tableName: 'plive_blocks',
    endpoint: '',
  },
};

export const DEFAULT_DYNAMO_ENVIRONMENT: string = 'local';

/**
 * Window chrome colors — shared by the Electron main process (BrowserWindow
 * backgroundColor / Windows titleBarOverlay) and the renderer stylesheet, so
 * the native title bar cannot drift from the app's own palette.
 */
export const APP_CHROME = {
  /** Matches --bg-primary in styles.css */
  background: '#0f172a',
  /** Matches --bg-secondary — the sidebar / title-bar strip */
  titleBar: '#1e293b',
  /** Matches --text-primary — Windows caption button glyphs */
  symbol: '#f1f5f9',
  titleBarHeight: 36,
} as const;
