// Requires: npm install arangojs
let Database: unknown = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('arangojs').Database;
} catch { /* optional dependency */ }

import type { ProviderCapabilities } from '../../types/ICapabilities';
import type { ArangoDBConnectionConfig, QueryDialect } from '../../types/IConnectionConfig';
import type { ConnectionState, SchemaInfo } from '../../types/IGraphProvider';
import type { QueryResult } from '../../types/IQueryResult';
import { BaseProvider, type Logger } from '../BaseProvider';

export class ArangoProvider extends BaseProvider {
  readonly capabilities: ProviderCapabilities = {
    supportsTransactions: true,
    supportsSchema: true,
    supportsMultiGraph: true,
    supportsStreaming: false,
    supportsGremlin: false,
    supportsCypher: false,
    supportsOpenCypher: false,
    supportsNGQL: false,
    supportsSPARQL: false,
    supportsGraphQL: true,
    supportsBulkLoad: true,
    supportsPropertyGraph: true,
    supportsRDFGraph: false,
    maxConnectionsPerPool: 10,
  };

  private db: unknown = null;

  constructor(
    id: string,
    public override readonly config: ArangoDBConnectionConfig,
    logger?: Logger,
  ) {
    super(id, config, logger);
  }

  async connect(): Promise<void> {
    if (!Database) throw new Error('arangojs is not installed. Run: npm install arangojs');
    const protocol = this.config.ssl ? 'https' : 'http';
    const url = `${protocol}://${this.config.host}:${this.config.port}`;
    this.log('info', `Connecting to ArangoDB at ${url}`);

    const DbClass = Database as new (opts: object) => unknown;
    this.db = new DbClass({
      url,
      databaseName: this.config.database ?? '_system',
      auth: this.config.useBearerAuth
        ? { token: this.config.token ?? '' }
        : { username: this.config.username ?? 'root', password: this.config.password ?? '' },
    });

    // Verify connection
    await (this.db as { version(): Promise<unknown> }).version();
    this.log('info', 'Connected to ArangoDB');
  }

  async disconnect(): Promise<void> {
    this.db = null;
  }

  async healthCheck(): Promise<ConnectionState> {
    if (!this.db) return { connected: false };
    const start = Date.now();
    try {
      await (this.db as { version(): Promise<unknown> }).version();
      return { connected: true, latencyMs: Date.now() - start, lastPing: new Date() };
    } catch (err) {
      return { connected: false, error: (err as Error).message };
    }
  }

  async executeQuery<T = unknown>(
    query: string,
    dialect: QueryDialect,
    parameters: Record<string, unknown> = {},
  ): Promise<QueryResult<T>> {
    this.validateDialect(dialect);
    if (!this.db) throw new Error('Not connected to ArangoDB');
    const start = Date.now();

    return this.withRetry(async () => {
      const cursor = await (this.db as {
        query(q: string, b: Record<string, unknown>): Promise<{ all(): Promise<unknown[]> }>;
      }).query(query, parameters);
      const data = (await cursor.all()) as T[];
      return { success: true, data, duration: Date.now() - start, count: data.length };
    }, 'ArangoDB query');
  }

  async introspectSchema(): Promise<SchemaInfo> {
    return { vertexLabels: [], edgeLabels: [], propertyKeys: [] };
  }

  async listGraphs(): Promise<string[]> {
    if (!this.db) return [];
    try {
      const graphs = await (this.db as { listGraphs(): Promise<Array<{ name: string }>> }).listGraphs();
      return graphs.map((g) => g.name);
    } catch {
      return [];
    }
  }
}
