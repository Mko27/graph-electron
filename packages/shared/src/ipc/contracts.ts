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
  profile?: string;
}

// ── dynamo-configure ─────────────────────────────────────────────────────────

export interface DynamoConfigureRequest {
  region?: string;
  tableName?: string;
  endpoint?: string;
  /** Named AWS profile (incl. SSO) used to resolve credentials. */
  profile?: string;
  /** Environment id this config came from — echoed back for display only. */
  environment?: string;
}

export interface DynamoConfigResponse {
  success: boolean;
  region?: string;
  tableName?: string;
  endpoint?: string;
  profile?: string;
  environment?: string;
  message?: string;
}

// ── workspace:load / workspace:save ──────────────────────────────────────────

export interface PersistedTab {
  id: string;
  name: string;
  query: string;
  /**
   * Environment this tab queries. Older workspaces only carry `connectionId`;
   * the renderer maps that to the environment that owns the connection.
   */
  environmentId?: string | null;
  connectionId: string | null;
  activeResultTab: 'table' | 'graph' | 'json';
  history: Array<{ query: string; success: boolean; timestamp: string }>;
}

/**
 * An environment pairs one graph endpoint with one DynamoDB source, so picking
 * "Stage" in a query tab points both at stage and they cannot drift apart.
 * `connectionId` indexes into WorkspaceState.connections (where secrets are
 * encrypted separately); null means the environment has no endpoint yet.
 */
export interface PersistedEnvironment {
  id: string;
  label: string;
  connectionId: string | null;
  dynamo: { region: string; tableName: string; endpoint: string; profile?: string };
}

export interface PersistedDynamoState {
  /** Active environment id (a key of `environments`). */
  environment: string;
  /** Full editable environment map, keyed by environment id. */
  environments: Record<
    string,
    { label: string; region: string; tableName: string; endpoint: string; profile?: string }
  >;
}

export interface PersistedUiState {
  /**
   * Fallback for vertex types with no entry in `graphLabelModes` — a property
   * key, or one of the __auto__/__label__/__id__ sentinels.
   */
  graphLabelProperty?: string;
  /**
   * What each vertex type shows inside its node, keyed by vertex label
   * (e.g. { block: 'block_type', principal: 'principal' }). One property cannot
   * label a mixed graph, so the choice is per type and kept for the workspace.
   */
  graphLabelModes?: Record<string, string>;
  /** The same, per edge type — Auto draws the type itself (`NESTED_IN`). */
  graphEdgeLabelModes?: Record<string, string>;
  /** Environment last opened in the sidebar editor. */
  selectedEnvironmentId?: string;
  /** Height in px the user dragged the query editor to; absent = the default. */
  queryPanelHeight?: number;
  /**
   * Open/closed state of each collapsible sidebar section, keyed by section id.
   * Absent ids fall back to the section's own default, so a newly-shipped
   * section is not forced closed by an older saved workspace.
   */
  sidebarSections?: Record<string, boolean>;
}

export interface WorkspaceState {
  version: number;
  connections: ProviderConnectionDto[];
  activeConnectionId: string | null;
  tabs: PersistedTab[];
  activeTabId: string | null;
  /** Environments (graph endpoint + DynamoDB source). Absent in v1 workspaces. */
  environments?: PersistedEnvironment[];
  /**
   * Legacy DynamoDB-only environment map. Still written so an older build can
   * read the file, and used to migrate a workspace saved before environments.
   */
  dynamo?: PersistedDynamoState;
  ui?: PersistedUiState;
}

export interface WorkspaceLoadResponse {
  success: boolean;
  state?: WorkspaceState;
  /**
   * False when OS-backed encryption is unavailable — connection secrets
   * (password / token / primaryKey) are then NOT written to disk, and restored
   * connections will need their credentials re-entered before connecting.
   */
  secretsAvailable: boolean;
  /**
   * Ids of connections that have a saved credential in the main process.
   *
   * The secrets themselves are deliberately NOT sent: the renderer only needs
   * to know it can connect without prompting. The connect handler fills the
   * real values in on the way to the driver.
   */
  connectionsWithSecrets: string[];
  message?: string;
}

export interface WorkspaceSaveResponse {
  success: boolean;
  message?: string;
}

// ── aws:list-profiles ────────────────────────────────────────────────────────

export interface AwsProfilesResponse {
  success: boolean;
  /** Named profiles found in the shared AWS config, "default" first. */
  profiles: string[];
  /** Files that were checked — surfaced when the list comes back empty. */
  sources: string[];
  message?: string;
}
