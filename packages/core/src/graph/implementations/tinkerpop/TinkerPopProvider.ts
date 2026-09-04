// Generic Apache TinkerPop 3.x provider — connects to any Gremlin Server
// over WebSocket. Works with TinkerGraph, Amazon Neptune (alt path),
// HaloDB, and any TinkerPop-compatible graph.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gremlin = require('gremlin');

import type { ProviderCapabilities } from '../../types/ICapabilities';
import type { TinkerPopConnectionConfig, QueryDialect } from '../../types/IConnectionConfig';
import type { ConnectionState, SchemaInfo } from '../../types/IGraphProvider';
import type { QueryResult } from '../../types/IQueryResult';
import { BaseProvider, type Logger } from '../BaseProvider';
import { normalizeGremlinResult } from '../shared/gremlinResultNormalizer';
import { GREMLIN_MIME_TYPE } from '../shared/gremlinSerializer';

export class TinkerPopProvider extends BaseProvider {
  readonly capabilities: ProviderCapabilities = {
    supportsTransactions: false, // Depends on backend; TinkerGraph is non-transactional
    supportsSchema: false,
    supportsMultiGraph: false,
    supportsStreaming: false,
    supportsGremlin: true,
    supportsCypher: false,
    supportsOpenCypher: false,
    supportsNGQL: false,
    supportsSPARQL: false,
    supportsGraphQL: false,
    supportsBulkLoad: false,
    supportsPropertyGraph: true,
    supportsRDFGraph: false,
    maxConnectionsPerPool: 5,
  };

  private client: unknown = null;

  constructor(
    id: string,
    public override readonly config: TinkerPopConnectionConfig,
    logger?: Logger,
  ) {
    super(id, config, logger);
  }

  async connect(): Promise<void> {
    const protocol = this.config.ssl ? 'wss' : 'ws';
    const url = `${protocol}://${this.config.host}:${this.config.port}/gremlin`;
    this.log('info', `Connecting to TinkerPop server at ${url}`);

    const { Client } = gremlin.driver;
    this.client = new Client(url, {
      traversalSource: this.config.traversalSource ?? 'g',
      mimeType: GREMLIN_MIME_TYPE,
    });
    await (this.client as { open(): Promise<void> }).open();
    this.log('info', `Connected to TinkerPop server at ${url}`);
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;
    // close() returns a promise — awaiting it means "disconnected" is true
    // by the time we say so, instead of while the socket is still closing.
    await (this.client as { close(): Promise<void> | void }).close();
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
    if (!this.client) throw new Error('Not connected to TinkerPop server');
    const start = Date.now();

    this.validateQuery(query, dialect);

    return this.withQueryRetry(query, dialect, async () => {
      const rs = await this.withTimeout(
        (this.client as { submit(q: string, b: Record<string, unknown>): Promise<unknown> })
          .submit(query, parameters),
        this.config.queryTimeoutMs ?? 30_000,
        'TinkerPop query',
      );
      const raw = (rs as { toArray(): unknown[] }).toArray();
      const data = raw.map((v) => normalizeGremlinResult(v)) as T[];
      return { success: true, data, duration: Date.now() - start, count: data.length };
    }, 'TinkerPop query');
  }

  async introspectSchema(): Promise<SchemaInfo> {
    if (!this.client) return { vertexLabels: [], edgeLabels: [], propertyKeys: [] };
    try {
      const submit = (q: string) =>
        (this.client as { submit(q: string, b: object): Promise<unknown> })
          .submit(q, {})
          .then((rs) => (rs as { toArray(): unknown[] }).toArray());

      const [vLabels, eLabels] = await Promise.all([
        submit('g.V().label().dedup()'),
        submit('g.E().label().dedup()'),
      ]);

      return {
        vertexLabels: (vLabels as string[]).map((label) => ({ label, properties: [] })),
        edgeLabels: (eLabels as string[]).map((label) => ({ label, properties: [] })),
        propertyKeys: [],
      };
    } catch {
      return { vertexLabels: [], edgeLabels: [], propertyKeys: [] };
    }
  }

  async listGraphs(): Promise<string[]> {
    return [this.config.host];
  }
}
