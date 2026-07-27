// JanusGraph speaks Gremlin over WebSocket — same protocol as Neptune.
// We reuse the gremlin npm package (already installed).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gremlin = require('gremlin');

import type { ProviderCapabilities } from '../../types/ICapabilities';
import type { JanusGraphConnectionConfig, QueryDialect } from '../../types/IConnectionConfig';
import type { ConnectionState, SchemaInfo } from '../../types/IGraphProvider';
import type { QueryResult } from '../../types/IQueryResult';
import { BaseProvider, type Logger } from '../BaseProvider';

export class JanusGraphProvider extends BaseProvider {
  readonly capabilities: ProviderCapabilities = {
    supportsTransactions: true,
    supportsSchema: true,
    supportsMultiGraph: false,
    supportsStreaming: false,
    supportsGremlin: true,
    supportsCypher: false,
    supportsOpenCypher: false,
    supportsNGQL: false,
    supportsSPARQL: false,
    supportsGraphQL: false,
    supportsBulkLoad: true,
    supportsPropertyGraph: true,
    supportsRDFGraph: false,
    maxConnectionsPerPool: 5,
  };

  private client: unknown = null;

  constructor(
    id: string,
    public override readonly config: JanusGraphConnectionConfig,
    logger?: Logger,
  ) {
    super(id, config, logger);
  }

  async connect(): Promise<void> {
    const protocol = this.config.ssl ? 'wss' : 'ws';
    const url = `${protocol}://${this.config.host}:${this.config.port}/gremlin`;
    this.log('info', `Connecting to JanusGraph at ${url}`);

    const { Client } = gremlin.driver;
    this.client = new Client(url, {
      traversalSource: this.config.traversalSource ?? 'g',
      mimeType: 'application/json',
      pingEnabled: true,
    });
    await (this.client as { open(): Promise<void> }).open();
    this.log('info', `Connected to JanusGraph at ${url}`);
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
    if (!this.client) throw new Error('Not connected to JanusGraph');

    const start = Date.now();
    return this.withRetry(async () => {
      const rs = await this.withTimeout(
        (this.client as { submit(q: string, b: Record<string, unknown>): Promise<unknown> })
          .submit(query, parameters),
        this.config.queryTimeoutMs ?? 30_000,
        'JanusGraph query',
      );
      const data = (rs as { toArray(): unknown[] }).toArray() as T[];
      return { success: true, data, duration: Date.now() - start, count: data.length };
    }, 'JanusGraph query');
  }

  async introspectSchema(): Promise<SchemaInfo> {
    // JanusGraph management API is available via Gremlin
    // Full implementation would query mgmt.getVertexLabels() etc.
    // via a management transaction; omitted here for brevity.
    return { vertexLabels: [], edgeLabels: [], propertyKeys: [] };
  }

  async listGraphs(): Promise<string[]> {
    return [this.config.host];
  }
}
