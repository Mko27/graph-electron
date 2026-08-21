export type DatabaseType =
  | 'neptune'
  | 'janusgraph'
  | 'neo4j'
  | 'arangodb'
  | 'cosmosdb'
  | 'orientdb'
  | 'tigergraph'
  | 'nebula'
  | 'tinkerpop';

export type QueryDialect =
  | 'gremlin'
  | 'cypher'
  | 'opencypher'
  | 'ngql'
  | 'graphql'
  | 'sparql'
  | 'gsql';

export interface BaseConnectionConfig {
  id: string;
  name: string;
  dbType: DatabaseType;
  dialect: QueryDialect;
  host: string;
  port: number;
  ssl: boolean;
  connectionTimeoutMs?: number;
  queryTimeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  poolMin?: number;
  poolMax?: number;
}

export interface NeptuneConnectionConfig extends BaseConnectionConfig {
  dbType: 'neptune';
  dialect: 'gremlin' | 'opencypher';
  region?: string;
  useIamAuth?: boolean;
  traversalSource?: string;
  /**
   * Named AWS CLI profile (~/.aws/credentials or ~/.aws/config) to resolve
   * credentials from, including SSO profiles set up via `aws configure sso`.
   * Falls back to the default credential provider chain when unset.
   */
  profile?: string;
}

export interface Neo4jConnectionConfig extends BaseConnectionConfig {
  dbType: 'neo4j';
  dialect: 'cypher';
  username: string;
  password: string;
  database?: string;
  encrypted?: boolean;
  trustStrategy?: 'TRUST_ALL_CERTIFICATES' | 'TRUST_SYSTEM_CA_SIGNED_CERTIFICATES';
}

export interface ArangoDBConnectionConfig extends BaseConnectionConfig {
  dbType: 'arangodb';
  dialect: 'graphql' | 'gremlin';
  username?: string;
  password?: string;
  database?: string;
  useBearerAuth?: boolean;
  token?: string;
}

export interface JanusGraphConnectionConfig extends BaseConnectionConfig {
  dbType: 'janusgraph';
  dialect: 'gremlin';
  traversalSource?: string;
  serializer?: 'GraphSON2' | 'GraphSON3';
}

export interface CosmosDBConnectionConfig extends BaseConnectionConfig {
  dbType: 'cosmosdb';
  dialect: 'gremlin';
  primaryKey: string;
  database: string;
  collection: string;
}

export interface OrientDBConnectionConfig extends BaseConnectionConfig {
  dbType: 'orientdb';
  dialect: 'gremlin' | 'graphql';
  username: string;
  password: string;
  database?: string;
}

export interface TigerGraphConnectionConfig extends BaseConnectionConfig {
  dbType: 'tigergraph';
  dialect: 'gsql' | 'graphql';
  username?: string;
  password?: string;
  token?: string;
  graphName?: string;
  secret?: string;
}

// nGQL is TigerGraph's query language, but NebulaGraph also uses it
export interface NebulaConnectionConfig extends BaseConnectionConfig {
  dbType: 'nebula';
  dialect: 'ngql';
  username: string;
  password: string;
  space?: string;
}

export interface TinkerPopConnectionConfig extends BaseConnectionConfig {
  dbType: 'tinkerpop';
  dialect: 'gremlin';
  traversalSource?: string;
  serializer?: 'GraphSON2' | 'GraphSON3';
}

export type ProviderConnectionConfig =
  | NeptuneConnectionConfig
  | Neo4jConnectionConfig
  | ArangoDBConnectionConfig
  | JanusGraphConnectionConfig
  | CosmosDBConnectionConfig
  | OrientDBConnectionConfig
  | TigerGraphConnectionConfig
  | NebulaConnectionConfig
  | TinkerPopConnectionConfig;

export const DIALECT_COMPATIBILITY: Record<DatabaseType, QueryDialect[]> = {
  neptune: ['gremlin', 'opencypher'],
  janusgraph: ['gremlin'],
  neo4j: ['cypher'],
  arangodb: ['graphql', 'gremlin'],
  cosmosdb: ['gremlin'],
  orientdb: ['gremlin', 'graphql'],
  tigergraph: ['gsql' as QueryDialect, 'graphql'],
  nebula: ['ngql'],
  tinkerpop: ['gremlin'],
};
