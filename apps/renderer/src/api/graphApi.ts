/**
 * graphApi — typed IPC client for the renderer process.
 *
 * ALL communication with the main process goes through these functions.
 * No component or hook should call window.graphClient directly.
 *
 * Rule: always use IpcChannels constants — never raw string literals.
 */
import { IpcChannels } from '@graph-client/shared';
import type {
  GraphProvidersResponse,
  GraphConnectResponse,
  GraphHealthResponse,
  GraphQueryRequest,
  GraphQueryResponse,
  GraphSchemaResponse,
  GraphListGraphsResponse,
  GraphConnectionsResponse,
  ProviderConnectionDto,
  DynamoConfigureRequest,
  DynamoConfigResponse,
  WorkspaceState,
  WorkspaceLoadResponse,
  WorkspaceSaveResponse,
  AwsProfilesResponse,
} from '@graph-client/shared';

// window.graphClient is exposed by apps/electron/src/windows/preload.ts
declare global {
  interface Window {
    graphClient: {
      invoke: (channel: string, payload?: unknown) => Promise<unknown>;
      platform?: string;
    };
  }
}

function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  return window.graphClient.invoke(channel, payload) as Promise<T>;
}

/** Host platform, or 'unknown' outside Electron (e.g. a browser-based test run). */
export const hostPlatform: string = window.graphClient?.platform ?? 'unknown';

export const graphApi = {
  // ── Provider metadata ──────────────────────────────────────────────────────
  providers: (): Promise<GraphProvidersResponse> =>
    invoke(IpcChannels.GRAPH_PROVIDERS),

  // ── Connection lifecycle ───────────────────────────────────────────────────
  connect: (config: ProviderConnectionDto): Promise<GraphConnectResponse> =>
    invoke(IpcChannels.GRAPH_CONNECT, { config }),

  disconnect: (id: string): Promise<{ success: boolean; message?: string }> =>
    invoke(IpcChannels.GRAPH_DISCONNECT, { id }),

  health: (id: string): Promise<GraphHealthResponse> =>
    invoke(IpcChannels.GRAPH_HEALTH, { id }),

  connections: (): Promise<GraphConnectionsResponse> =>
    invoke(IpcChannels.GRAPH_CONNECTIONS),

  // ── Query execution ────────────────────────────────────────────────────────
  query: (req: GraphQueryRequest): Promise<GraphQueryResponse> =>
    invoke(IpcChannels.GRAPH_QUERY, req),

  // ── Schema introspection ───────────────────────────────────────────────────
  schema: (id: string): Promise<GraphSchemaResponse> =>
    invoke(IpcChannels.GRAPH_SCHEMA, { id }),

  listGraphs: (id: string): Promise<GraphListGraphsResponse> =>
    invoke(IpcChannels.GRAPH_LIST_GRAPHS, { id }),

  // ── DynamoDB enrichment ────────────────────────────────────────────────────
  dynamoConfigure: (req: DynamoConfigureRequest): Promise<DynamoConfigResponse> =>
    invoke(IpcChannels.DYNAMO_CONFIGURE, req),

  dynamoGetConfig: () =>
    invoke<{
      region: string;
      tableName: string;
      endpoint: string;
      profile: string;
      environment: string;
      initialized: boolean;
    }>(IpcChannels.DYNAMO_GET_CONFIG),

  dynamoFetchItem: (id: string) =>
    invoke<{ success: boolean; data?: Record<string, unknown> | null; message?: string }>(
      IpcChannels.DYNAMO_FETCH_ITEM,
      { id },
    ),

  // ── AWS shared config ──────────────────────────────────────────────────────
  awsListProfiles: (): Promise<AwsProfilesResponse> =>
    invoke(IpcChannels.AWS_LIST_PROFILES),

  // ── Workspace persistence ──────────────────────────────────────────────────
  workspaceLoad: (): Promise<WorkspaceLoadResponse> =>
    invoke(IpcChannels.WORKSPACE_LOAD),

  workspaceSave: (state: WorkspaceState): Promise<WorkspaceSaveResponse> =>
    invoke(IpcChannels.WORKSPACE_SAVE, { state }),

  workspaceClear: (): Promise<{ success: boolean; message?: string }> =>
    invoke(IpcChannels.WORKSPACE_CLEAR),
};
