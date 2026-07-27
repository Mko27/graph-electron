// Public surface of the provider system — import from here, not from subdirectories.

export type {
  ProviderCapabilities,
  GraphVertex,
  GraphEdge,
  GraphElement,
  QueryResult,
  QueryMetadata,
  DatabaseType,
  QueryDialect,
  ProviderConnectionConfig,
  NeptuneConnectionConfig,
  Neo4jConnectionConfig,
  ArangoDBConnectionConfig,
  JanusGraphConnectionConfig,
  CosmosDBConnectionConfig,
  OrientDBConnectionConfig,
  TigerGraphConnectionConfig,
  NebulaConnectionConfig,
  TinkerPopConnectionConfig,
  IGraphProvider,
  ConnectionState,
  SchemaInfo,
  TransactionContext,
  IQueryDialect,
  DialectValidationResult,
} from './types';

export { DIALECT_COMPATIBILITY } from './types';
export { ConnectionFactory } from './factory';
export { ProviderRegistry, DialectRegistry } from './registry';
export { ConnectionPool } from './pool';
export type { PoolConfig } from './pool';
