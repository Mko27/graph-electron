// NebulaGraph uses its own nGQL dialect and the nebula-javascript driver.
// Requires: npm install nebula-javascript (or nebula-nodejs depending on version)
let NebulaClient: unknown = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  NebulaClient = require('nebula-javascript');
} catch {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    NebulaClient = require('nebula-nodejs');
  } catch { /* optional dependency */ }
}

import type { ProviderCapabilities } from '../../types/ICapabilities';
import type { NebulaConnectionConfig, QueryDialect } from '../../types/IConnectionConfig';
import type { ConnectionState, SchemaInfo } from '../../types/IGraphProvider';
import type { QueryResult } from '../../types/IQueryResult';
import { BaseProvider, type Logger } from '../BaseProvider';

export class NebulaProvider extends BaseProvider {
  readonly capabilities: ProviderCapabilities = {
    supportsTransactions: false,
    supportsSchema: true,
    supportsMultiGraph: true, // NebulaGraph calls them "spaces"
    supportsStreaming: false,
    supportsGremlin: false,
    supportsCypher: false,
    supportsOpenCypher: false,
    supportsNGQL: true,
    supportsSPARQL: false,
    supportsGraphQL: false,
    supportsBulkLoad: true,
    supportsPropertyGraph: true,
    supportsRDFGraph: false,
    maxConnectionsPerPool: 5,
  };

  private session: unknown = null;
  private pool: unknown = null;

  constructor(
    id: string,
    public override readonly config: NebulaConnectionConfig,
    logger?: Logger,
  ) {
    super(id, config, logger);
  }

  async connect(): Promise<void> {
    if (!NebulaClient) {
      throw new Error(
        'NebulaGraph driver not installed. Run: npm install nebula-javascript',
      );
    }
    this.log('info', `Connecting to NebulaGraph at ${this.config.host}:${this.config.port}`);

    const clientModule = NebulaClient as {
      ConnectionPool?: new (hosts: object[], config: object) => {
        init(): Promise<boolean>;
        getSession(user: string, pass: string): Promise<{
          execute(query: string): Promise<{ isSucceed(): boolean; getErrorMsg(): string; getRows(): unknown[] }>;
          release(): Promise<void>;
        }>;
      };
    };

    if (clientModule.ConnectionPool) {
      this.pool = new clientModule.ConnectionPool(
        [{ address: this.config.host, port: this.config.port }],
        { maxSize: this.config.poolMax ?? 5, minSize: this.config.poolMin ?? 1 },
      );
      await (this.pool as { init(): Promise<boolean> }).init();
      this.session = await (this.pool as {
        getSession(u: string, p: string): Promise<unknown>;
      }).getSession(this.config.username, this.config.password);
    } else {
      throw new Error('Incompatible NebulaGraph driver version');
    }

    if (this.config.space) {
      await this._exec(`USE ${this.config.space}`);
    }

    this.log('info', 'Connected to NebulaGraph');
  }

  async disconnect(): Promise<void> {
    if (this.session) {
      await (this.session as { release(): Promise<void> }).release().catch(() => undefined);
      this.session = null;
    }
    this.pool = null;
  }

  async healthCheck(): Promise<ConnectionState> {
    if (!this.session) return { connected: false };
    const start = Date.now();
    try {
      await this._exec('SHOW SPACES');
      return { connected: true, latencyMs: Date.now() - start, lastPing: new Date() };
    } catch (err) {
      return { connected: false, error: (err as Error).message };
    }
  }

  async executeQuery<T = unknown>(
    query: string,
    dialect: QueryDialect,
    _parameters: Record<string, unknown> = {},
  ): Promise<QueryResult<T>> {
    this.validateDialect(dialect);
    if (!this.session) throw new Error('Not connected to NebulaGraph');
    const start = Date.now();

    return this.withRetry(async () => {
      const rows = await this._exec(query);
      return { success: true, data: rows as T[], duration: Date.now() - start, count: rows.length };
    }, 'NebulaGraph query');
  }

  async introspectSchema(): Promise<SchemaInfo> {
    if (!this.session) return { vertexLabels: [], edgeLabels: [], propertyKeys: [] };
    try {
      const [tagRows, edgeRows] = await Promise.all([
        this._exec('SHOW TAGS'),
        this._exec('SHOW EDGES'),
      ]);
      return {
        vertexLabels: tagRows.map((r) => ({ label: String(r), properties: [] })),
        edgeLabels: edgeRows.map((r) => ({ label: String(r), properties: [] })),
        propertyKeys: [],
      };
    } catch {
      return { vertexLabels: [], edgeLabels: [], propertyKeys: [] };
    }
  }

  async listGraphs(): Promise<string[]> {
    try {
      const rows = await this._exec('SHOW SPACES');
      return rows.map(String);
    } catch {
      return [this.config.space ?? this.config.host];
    }
  }

  private async _exec(query: string): Promise<unknown[]> {
    const result = await (this.session as {
      execute(q: string): Promise<{
        isSucceed(): boolean;
        getErrorMsg(): string;
        getRows(): unknown[];
      }>;
    }).execute(query);

    if (!result.isSucceed()) {
      throw new Error(`NebulaGraph query failed: ${result.getErrorMsg()}`);
    }
    return result.getRows();
  }
}
