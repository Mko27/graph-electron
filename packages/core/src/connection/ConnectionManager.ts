import { ConnectionFactory } from '../graph/factory/ConnectionFactory';
import { ConnectionPool } from '../graph/pool/ConnectionPool';
import type { IGraphProvider, ConnectionState, SchemaInfo } from '../graph/types/IGraphProvider';
import type { ProviderConnectionConfig, QueryDialect } from '../graph/types/IConnectionConfig';
import type { QueryResult } from '../graph/types/IQueryResult';
import type { Logger } from '../logging';

interface ManagedConnection {
  provider: IGraphProvider;
  pool: ConnectionPool | null;
  config: ProviderConnectionConfig;
}

/**
 * ConnectionManager — single owner of all active provider connections.
 *
 * Instantiated once in the Electron main process.
 * Every IPC handler routes through this manager.
 *
 * Pool vs single-connection:
 *   If config.poolMax > 1, a ConnectionPool is created and all queries
 *   acquire/release slots from it. Otherwise, a single IGraphProvider is used.
 */
export class ConnectionManager {
  private readonly factory: ConnectionFactory;
  private readonly connections = new Map<string, ManagedConnection>();

  constructor(private readonly log: Logger) {
    this.factory = new ConnectionFactory();
  }

  async connect(config: ProviderConnectionConfig): Promise<{ success: boolean; url: string }> {
    await this.disconnect(config.id).catch(() => undefined);

    const usePool = (config.poolMax ?? 1) > 1;

    if (usePool) {
      const pool = new ConnectionPool(
        () => this.factory.createProvider(config, this.log),
        { min: config.poolMin ?? 1, max: config.poolMax ?? 5 },
      );
      await pool.initialize();
      const provider = this.factory.createProvider(config, this.log);
      this.connections.set(config.id, { provider, pool, config });
    } else {
      const provider = this.factory.createProvider(config, this.log);
      await provider.connect();
      this.connections.set(config.id, { provider, pool: null, config });
    }

    const url = `${config.ssl ? 'wss' : 'ws'}://${config.host}:${config.port}`;
    this.log('info', `Connection "${config.id}" established (${config.dbType}/${config.dialect})`);
    return { success: true, url };
  }

  async disconnect(id: string): Promise<void> {
    const conn = this.connections.get(id);
    if (!conn) return;
    if (conn.pool) await conn.pool.close().catch(() => undefined);
    else await conn.provider.disconnect().catch(() => undefined);
    this.connections.delete(id);
    this.log('info', `Connection "${id}" closed`);
  }

  async disconnectAll(): Promise<void> {
    await Promise.allSettled([...this.connections.keys()].map((id) => this.disconnect(id)));
  }

  async executeQuery<T = unknown>(
    id: string,
    query: string,
    dialect?: QueryDialect,
    parameters?: Record<string, unknown>,
  ): Promise<QueryResult<T>> {
    const conn = this._require(id);
    const effectiveDialect = dialect ?? conn.config.dialect;

    if (conn.pool) {
      const provider = await conn.pool.acquire();
      try {
        return await provider.executeQuery<T>(query, effectiveDialect, parameters);
      } finally {
        conn.pool.release(provider);
      }
    }

    return conn.provider.executeQuery<T>(query, effectiveDialect, parameters);
  }

  async healthCheck(id: string): Promise<ConnectionState> {
    const conn = this.connections.get(id);
    if (!conn) return { connected: false };
    if (conn.pool) return conn.pool.getState();
    return conn.provider.healthCheck();
  }

  async introspectSchema(id: string): Promise<SchemaInfo> {
    return this._require(id).provider.introspectSchema();
  }

  async listGraphs(id: string): Promise<string[]> {
    return this._require(id).provider.listGraphs();
  }

  getConfig(id: string): ProviderConnectionConfig | undefined {
    return this.connections.get(id)?.config;
  }

  listConnections(): Array<{ id: string; dbType: string; dialect: string; host: string }> {
    return [...this.connections.entries()].map(([id, conn]) => ({
      id,
      dbType: conn.config.dbType,
      dialect: conn.config.dialect,
      host: conn.config.host,
    }));
  }

  listProviders() {
    return this.factory.listProviders();
  }

  listDialects() {
    return this.factory.listDialects();
  }

  private _require(id: string): ManagedConnection {
    const conn = this.connections.get(id);
    if (!conn) throw new Error(`Connection "${id}" not found — call connect() first`);
    return conn;
  }
}
