/**
 * IPC Request / Response Contracts
 *
 * Every IPC call has an explicit typed request and response shape.
 * Import these in both the Electron handler (main process) and the
 * renderer API wrapper so the contract is enforced at compile time.
 */

// ── Shared result shapes ─────────────────────────────────────────────────────

export interface IpcSuccess<T = unknown> {
  success: true;
  data?: T;
}

export interface IpcError {
  success: false;
  message: string;
  code?: string;
}

export type IpcResult<T = unknown> = IpcSuccess<T> | IpcError;

// ── graph:providers ──────────────────────────────────────────────────────────

export interface ProviderInfo {
  dbType: string;
  displayName: string;
  description: string;
}

export interface DialectInfo {
  name: string;
  displayName: string;
  fileExtension: string;
}

export interface GraphProvidersResponse {
  success: boolean;
  providers: ProviderInfo[];
  dialects: DialectInfo[];
  message?: string;
}

// ── graph:connect ────────────────────────────────────────────────────────────

export interface GraphConnectRequest {
  config: ProviderConnectionDto;
}

export interface GraphConnectResponse {
  success: boolean;
  url?: string;
  message?: string;
}

// ── graph:disconnect ─────────────────────────────────────────────────────────

export interface GraphDisconnectRequest {
  id: string;
}

// ── graph:health ─────────────────────────────────────────────────────────────

export interface GraphHealthRequest {
  id: string;
}

export interface GraphHealthResponse {
  connected: boolean;
  latencyMs?: number;
  lastPing?: string; // ISO date string (Date is not IPC-serializable)
  poolSize?: number;
  activeConnections?: number;
  idleConnections?: number;
  error?: string;
}

// ── graph:query ──────────────────────────────────────────────────────────────

export interface GraphQueryRequest {
  id: string;
  query: string;
  dialect?: string;
  parameters?: Record<string, unknown>;
}

export interface GraphQueryResponse<T = unknown> {
  success: boolean;
  data?: T[];
  duration?: number;
  count?: number;
  message?: string;
  metadata?: {
    requestId?: string;
    warnings?: string[];
    profile?: { planningTimeMs?: number; executionTimeMs?: number };
  };
}

// ── graph:schema ─────────────────────────────────────────────────────────────

export interface GraphSchemaRequest {
  id: string;
}

export interface VertexSchemaDto {
  label: string;
  properties: Array<{ name: string; dataType: string; cardinality?: string }>;
  count?: number;
}

export interface EdgeSchemaDto {
  label: string;
  properties: Array<{ name: string; dataType: string }>;
  fromLabels?: string[];
  toLabels?: string[];
  count?: number;
}

export interface GraphSchemaResponse {
  success: boolean;
  vertexLabels?: VertexSchemaDto[];
  edgeLabels?: EdgeSchemaDto[];
  propertyKeys?: Array<{ name: string; dataType: string }>;
  message?: string;
}

// ── graph:list-graphs ────────────────────────────────────────────────────────

export interface GraphListGraphsRequest {
  id: string;
}

export interface GraphListGraphsResponse {
  success: boolean;
  graphs?: string[];
  message?: string;
}

// ── graph:connections ────────────────────────────────────────────────────────

export interface ConnectionSummary {
  id: string;
  dbType: string;
  dialect: string;
  host: string;
}

export interface GraphConnectionsResponse {
  success: boolean;
  connections: ConnectionSummary[];
}

// ── ProviderConnectionDto (what the UI sends to graph:connect) ───────────────

export interface ProviderConnectionDto {
  id: string;
  name: string;
  dbType: string;
  dialect: string;
  host: string;
  port: number;
  ssl: boolean;
  // Auth
  username?: string;
  password?: string;
  token?: string;
  primaryKey?: string;
  useIamAuth?: boolean;
  // Database selection
  database?: string;
  collection?: string;
  graphName?: string;
  space?: string;
  // Pool / timeouts
  poolMin?: number;
  poolMax?: number;
  connectionTimeoutMs?: number;
  queryTimeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  // Extra
  traversalSource?: string;
  region?: string;
}
