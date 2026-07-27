export { IpcChannels } from './ipc/channels';
export type { IpcChannelName } from './ipc/channels';

export type {
  IpcSuccess,
  IpcError,
  IpcResult,
  ProviderInfo,
  DialectInfo,
  GraphProvidersResponse,
  GraphConnectRequest,
  GraphConnectResponse,
  GraphDisconnectRequest,
  GraphHealthRequest,
  GraphHealthResponse,
  GraphQueryRequest,
  GraphQueryResponse,
  GraphSchemaRequest,
  VertexSchemaDto,
  EdgeSchemaDto,
  GraphSchemaResponse,
  GraphListGraphsRequest,
  GraphListGraphsResponse,
  ConnectionSummary,
  GraphConnectionsResponse,
  ProviderConnectionDto,
} from './ipc/contracts';

export {
  DB_TYPE_LABELS,
  DIALECT_LABELS,
  DEFAULT_PORTS,
  DEFAULT_QUERY_TIMEOUT_MS,
  DEFAULT_CONNECTION_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_POOL_MIN,
  DEFAULT_POOL_MAX,
  DIALECT_COMPATIBILITY,
  PROVIDER_CAPABILITIES,
} from './constants';
export type { UICapabilities } from './constants';
