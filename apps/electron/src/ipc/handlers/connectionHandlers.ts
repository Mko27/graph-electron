import type { IpcMain } from 'electron';
import type { ConnectionManager } from '@graph-client/core';
import type { IpcChannels as IpcChannelsType } from '@graph-client/shared';
import type { IpcDependencies } from '../registry';

const VALID_DB_TYPES = new Set([
  'neptune','neo4j','janusgraph','arangodb','cosmosdb','orientdb','tigergraph','nebula','tinkerpop',
]);
const VALID_DIALECTS = new Set(['gremlin','cypher','opencypher','ngql','graphql','sparql','gsql']);

export function validateConnect(config: unknown): string | null {
  if (!config || typeof config !== 'object') return 'config is required';
  const c = config as Record<string, unknown>;
  if (!c.id || typeof c.id !== 'string') return 'config.id (string) is required';
  if (!c.dbType || !VALID_DB_TYPES.has(String(c.dbType))) return `config.dbType must be one of: ${[...VALID_DB_TYPES].join(', ')}`;
  if (!c.dialect || !VALID_DIALECTS.has(String(c.dialect))) return `config.dialect must be one of: ${[...VALID_DIALECTS].join(', ')}`;
  if (!c.host || typeof c.host !== 'string') return 'config.host (string) is required';
  if (typeof c.port !== 'number' || c.port <= 0) return 'config.port (positive number) is required';
  return null;
}

export function validateId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return 'id is required';
  const p = payload as Record<string, unknown>;
  if (!p.id || typeof p.id !== 'string') return 'id (string) is required';
  return null;
}

export function registerConnectionHandlers(
  ipcMain: IpcMain,
  channels: typeof IpcChannelsType,
  { connectionManager, log }: IpcDependencies,
): void {
  // ── List available providers and dialects ────────────────────────────────
  ipcMain.handle(channels.GRAPH_PROVIDERS, () => {
    return {
      success: true,
      providers: connectionManager.listProviders(),
      dialects: connectionManager.listDialects(),
    };
  });

  // ── Connect to a graph database ──────────────────────────────────────────
  ipcMain.handle(channels.GRAPH_CONNECT, async (_event, payload) => {
    const config = (payload as Record<string, unknown>)?.config;
    const validationError = validateConnect(config);
    if (validationError) {
      log('warn', `graph:connect validation failed: ${validationError}`);
      return { success: false, message: validationError };
    }
    try {
      const result = await connectionManager.connect(config as Parameters<ConnectionManager['connect']>[0]);
      return { ...result };
    } catch (err) {
      log('error', `graph:connect error for "${(config as Record<string,unknown>).id}":`, (err as Error).message);
      return { success: false, message: (err as Error).message };
    }
  });

  // ── Disconnect ───────────────────────────────────────────────────────────
  ipcMain.handle(channels.GRAPH_DISCONNECT, async (_event, payload) => {
    const err = validateId(payload);
    if (err) return { success: false, message: err };
    try {
      await connectionManager.disconnect((payload as Record<string,string>).id);
      return { success: true };
    } catch (e) {
      return { success: false, message: (e as Error).message };
    }
  });

  // ── Health check ─────────────────────────────────────────────────────────
  ipcMain.handle(channels.GRAPH_HEALTH, async (_event, payload) => {
    const err = validateId(payload);
    if (err) return { connected: false, error: err };
    const state = await connectionManager.healthCheck((payload as Record<string,string>).id);
    return { ...state, lastPing: state.lastPing?.toISOString() };
  });

  // ── List active connections ──────────────────────────────────────────────
  ipcMain.handle(channels.GRAPH_CONNECTIONS, () => {
    return { success: true, connections: connectionManager.listConnections() };
  });

  // ── List graphs/spaces/databases in a connection ─────────────────────────
  ipcMain.handle(channels.GRAPH_LIST_GRAPHS, async (_event, payload) => {
    const err = validateId(payload);
    if (err) return { success: false, message: err };
    try {
      const graphs = await connectionManager.listGraphs((payload as Record<string,string>).id);
      return { success: true, graphs };
    } catch (e) {
      return { success: false, message: (e as Error).message };
    }
  });
}
