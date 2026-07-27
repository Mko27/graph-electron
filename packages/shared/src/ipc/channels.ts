/**
 * IPC Channel Constants
 *
 * Single source of truth for all Electron IPC channel names.
 * Both main process (handlers) and renderer (API wrappers) import from here,
 * so a rename is one change rather than a grep-and-replace across two packages.
 *
 * Convention:
 *   graph:*    — multi-provider system (new)
 *   connection:* — legacy Neptune-only channels (backwards-compatible)
 *   dynamo:*   — DynamoDB enrichment
 */
export const IpcChannels = {
  // ── Multi-provider ─────────────────────────────────────────────────────────
  GRAPH_PROVIDERS: 'graph:providers',
  GRAPH_CONNECT: 'graph:connect',
  GRAPH_DISCONNECT: 'graph:disconnect',
  GRAPH_HEALTH: 'graph:health',
  GRAPH_QUERY: 'graph:query',
  GRAPH_SCHEMA: 'graph:schema',
  GRAPH_LIST_GRAPHS: 'graph:list-graphs',
  GRAPH_CONNECTIONS: 'graph:connections',

  // ── Legacy Neptune (kept for backwards compatibility) ──────────────────────
  CONNECTION_CONNECT: 'connection:connect',
  CONNECTION_DISCONNECT: 'connection:disconnect',
  CONNECTION_REMOVE: 'connection:remove',
  CONNECTION_STATUS: 'connection:status',
  EXECUTE_QUERY: 'execute-query',
  GET_SCHEMA: 'get-schema',

  // ── DynamoDB enrichment ────────────────────────────────────────────────────
  DYNAMO_CONFIGURE: 'dynamo-configure',
  DYNAMO_GET_CONFIG: 'dynamo-get-config',
  DYNAMO_FETCH_ITEM: 'dynamo-fetch-item',
} as const;

export type IpcChannelName = (typeof IpcChannels)[keyof typeof IpcChannels];
