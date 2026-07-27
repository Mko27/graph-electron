// Graph provider system
export { ConnectionFactory } from './graph/factory/ConnectionFactory';
export { ProviderRegistry, DialectRegistry } from './graph/registry';
export { ConnectionPool } from './graph/pool';
export type { PoolConfig } from './graph/pool';

// All types
export type {
  ProviderCapabilities,
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
  QueryResult,
  GraphVertex,
  GraphEdge,
} from './graph/types';

export { DIALECT_COMPATIBILITY } from './graph/types';

// Connection management
export { ConnectionManager } from './connection';

// Query engine
export { ResultTransformer } from './query-engine';
export type { NormalizedVertex, NormalizedEdge, NormalizedElement } from './query-engine';

// Logging
export type { Logger, LogLevel } from './logging';
export { noopLogger, consoleLogger } from './logging';

// Utilities
export { withRetry, withTimeout } from './utils';
