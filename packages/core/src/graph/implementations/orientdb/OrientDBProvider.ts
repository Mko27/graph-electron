// OrientDB exposes Gremlin via its TinkerPop integration (port 8182 by default)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gremlin = require('gremlin');

import type { ProviderCapabilities } from '../../types/ICapabilities';
import type { OrientDBConnectionConfig, QueryDialect } from '../../types/IConnectionConfig';
import type { ConnectionState, SchemaInfo } from '../../types/IGraphProvider';
import type { QueryResult } from '../../types/IQueryResult';
import { BaseProvider, type Logger } from '../BaseProvider';

export class OrientDBProvider extends BaseProvider {
  readonly capabilities: ProviderCapabilities = {
    supportsTransactions: true,
    supportsSchema: true,
    supportsMultiGraph: true,
    supportsStreaming: false,
    supportsGremlin: true,
    supportsCypher: false,
    supportsOpenCypher: false,
    supportsNGQL: false,
    supportsSPARQL: false,
    supportsGraphQL: true,
    supportsBulkLoad: false,
    supportsPropertyGraph: true,
    supportsRDFGraph: false,
    maxConnectionsPerPool: 5,
  };

  private client: unknown = null;

  constructor(
    id: string,
    public override readonly config: OrientDBConnectionConfig,
    logger?: Logger,
  ) {
    super(id, config, logger);
  }

  async connect(): Promise<void> {
    const protocol = this.config.ssl ? 'wss' : 'ws';
    const url = `${protocol}://${this.config.host}:${this.config.port}/gremlin`;
    this.log('info', `Connecting to OrientDB at ${url}`);

    const authenticator = new gremlin.driver.auth.PlainTextSaslAuthenticator(
      this.config.username,
      this.config.password,
    );
    const { Client } = gremlin.driver;
    this.client = new Client(url, {
      authenticator,
      traversalSource: 'g',
    });
    await (this.client as { open(): Promise<void> }).open();
    this.log('info', 'Connected to OrientDB');
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;
    (this.client as { close(): void }).close();
    this.client = null;
  }

  async healthCheck(): Promise<ConnectionState> {
    if (!this.client) return { connected: false };
    const start = Date.now();
    try {
      const rs = await (this.client as { submit(q: string, b: object): Promise<unknown> })
        .submit('g.V().limit(1).count()', {});
      (rs as { toArray(): unknown[] }).toArray();
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
    if (!this.client) throw new Error('Not connected to OrientDB');
    const start = Date.now();

    return this.withRetry(async () => {
      const rs = await this.withTimeout(
        (this.client as { submit(q: string, b: Record<string, unknown>): Promise<unknown> })
          .submit(query, parameters),
        this.config.queryTimeoutMs ?? 30_000,
        'OrientDB query',
      );
      const data = (rs as { toArray(): unknown[] }).toArray() as T[];
      return { success: true, data, duration: Date.now() - start, count: data.length };
    }, 'OrientDB query');
  }

  async introspectSchema(): Promise<SchemaInfo> {
    return { vertexLabels: [], edgeLabels: [], propertyKeys: [] };
  }

  async listGraphs(): Promise<string[]> {
    return [this.config.database ?? this.config.host];
  }
}
