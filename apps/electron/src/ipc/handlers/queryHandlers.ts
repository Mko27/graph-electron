import type { IpcMain } from 'electron';
import type { QueryDialect } from '@graph-client/core';
import type { IpcChannels as IpcChannelsType } from '@graph-client/shared';
import type { IpcDependencies } from '../registry';

export function validateQuery(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return 'request body is required';
  const p = payload as Record<string, unknown>;
  if (!p.id || typeof p.id !== 'string') return 'id (string) is required';
  if (!p.query || typeof p.query !== 'string' || !p.query.trim()) return 'query (non-empty string) is required';
  return null;
}

export function registerQueryHandlers(
  ipcMain: IpcMain,
  channels: typeof IpcChannelsType,
  { connectionManager, log }: IpcDependencies,
): void {
  // ── Execute a query ──────────────────────────────────────────────────────
  ipcMain.handle(channels.GRAPH_QUERY, async (_event, payload) => {
    const validationError = validateQuery(payload);
    if (validationError) {
      log('warn', `graph:query validation failed: ${validationError}`);
      return { success: false, message: validationError };
    }
    const { id, query, dialect, parameters } = payload as {
      id: string;
      query: string;
      dialect?: QueryDialect;
      parameters?: Record<string, unknown>;
    };
    try {
      const start = Date.now();
      const result = await connectionManager.executeQuery(id, query, dialect, parameters);
      log('info', `graph:query on "${id}": ${result.count} results in ${Date.now() - start}ms`);
      return result;
    } catch (err) {
      log('error', `graph:query error on "${id}":`, (err as Error).message);
      return { success: false, message: (err as Error).message };
    }
  });

  // ── Schema introspection ─────────────────────────────────────────────────
  ipcMain.handle(channels.GRAPH_SCHEMA, async (_event, payload) => {
    if (!payload || typeof payload !== 'object' || !(payload as Record<string,unknown>).id) {
      return { success: false, message: 'id is required' };
    }
    const { id } = payload as { id: string };
    try {
      const schema = await connectionManager.introspectSchema(id);
      return { success: true, ...schema };
    } catch (err) {
      log('error', `graph:schema error on "${id}":`, (err as Error).message);
      return { success: false, message: (err as Error).message };
    }
  });
}
