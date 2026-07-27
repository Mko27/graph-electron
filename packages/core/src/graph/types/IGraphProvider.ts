import type { ProviderCapabilities } from './ICapabilities';
import type { ProviderConnectionConfig, QueryDialect } from './IConnectionConfig';
import type { QueryResult } from './IQueryResult';

export interface ConnectionState {
  connected: boolean;
  latencyMs?: number;
  lastPing?: Date;
  error?: string;
  poolSize?: number;
  activeConnections?: number;
  idleConnections?: number;
}

export interface PropertyDef {
  name: string;
  dataType: string;
  cardinality?: 'SINGLE' | 'LIST' | 'SET';
  required?: boolean;
}

export interface VertexSchema {
  label: string;
  properties: PropertyDef[];
  count?: number;
}

export interface EdgeSchema {
  label: string;
  properties: PropertyDef[];
  fromLabels?: string[];
  toLabels?: string[];
  count?: number;
}

export interface IndexSchema {
  name: string;
  type: 'vertex' | 'edge' | 'mixed';
  keys: string[];
  unique: boolean;
  composite: boolean;
}

export interface SchemaInfo {
  vertexLabels: VertexSchema[];
  edgeLabels: EdgeSchema[];
  propertyKeys: { name: string; dataType: string }[];
  indexes?: IndexSchema[];
}

export interface TransactionContext {
  id: string;
  startTime: Date;
  operationCount: number;
}

export interface IGraphProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  readonly config: ProviderConnectionConfig;

  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<ConnectionState>;

  // Query execution — dialect must be supported by this provider
  executeQuery<T = unknown>(
    query: string,
    dialect: QueryDialect,
    parameters?: Record<string, unknown>,
  ): Promise<QueryResult<T>>;

  // Schema introspection
  introspectSchema(): Promise<SchemaInfo>;
  listGraphs(): Promise<string[]>;

  // Optional transaction support
  beginTransaction?(): Promise<TransactionContext>;
  commitTransaction?(ctx: TransactionContext): Promise<void>;
  rollbackTransaction?(ctx: TransactionContext): Promise<void>;

  // Optional streaming support
  streamQuery?<T = unknown>(
    query: string,
    dialect: QueryDialect,
    onData: (chunk: T[]) => void,
    parameters?: Record<string, unknown>,
  ): Promise<void>;
}
