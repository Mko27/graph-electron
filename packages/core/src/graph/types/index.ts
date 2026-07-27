export type { ProviderCapabilities } from './ICapabilities';
export type {
  GraphVertex,
  GraphEdge,
  GraphElement,
  QueryProfile,
  QueryMetadata,
  QueryResult,
} from './IQueryResult';
export type {
  DatabaseType,
  QueryDialect,
  BaseConnectionConfig,
  NeptuneConnectionConfig,
  Neo4jConnectionConfig,
  ArangoDBConnectionConfig,
  JanusGraphConnectionConfig,
  CosmosDBConnectionConfig,
  OrientDBConnectionConfig,
  TigerGraphConnectionConfig,
  NebulaConnectionConfig,
  TinkerPopConnectionConfig,
  ProviderConnectionConfig,
} from './IConnectionConfig';
export { DIALECT_COMPATIBILITY } from './IConnectionConfig';
export type {
  ConnectionState,
  PropertyDef,
  VertexSchema,
  EdgeSchema,
  IndexSchema,
  SchemaInfo,
  TransactionContext,
  IGraphProvider,
} from './IGraphProvider';
export type { DialectValidationResult, IQueryDialect } from './IDialect';
