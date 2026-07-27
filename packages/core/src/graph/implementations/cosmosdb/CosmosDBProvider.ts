// Azure Cosmos DB Gremlin API uses the standard Gremlin WebSocket protocol
// with a special auth scheme: the password is the primary key.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gremlin = require('gremlin');

import type { ProviderCapabilities } from '../../types/ICapabilities';
import type { CosmosDBConnectionConfig, QueryDialect } from '../../types/IConnectionConfig';
import type { ConnectionState, SchemaInfo } from '../../types/IGraphProvider';
import type { QueryResult } from '../../types/IQueryResult';
import { BaseProvider, type Logger } from '../BaseProvider';

export class CosmosDBProvider extends BaseProvider {
  readonly capabilities: ProviderCapabilities = {
    supportsTransactions: false,
    supportsSchema: false,
    supportsMultiGraph: true, // Cosmos supports multiple containers/collections
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
    maxConnectionsPerPool: 3,
  };

  private client: unknown = null;

  constructor(
    id: string,
    public override readonly config: CosmosDBConnectionConfig,
    logger?: Logger,
  ) {
    super(id, config, logger);
  }

  async connect(): Promise<void> {
    // Cosmos DB Gremlin endpoint format:
    // wss://<account>.gremlin.cosmos.azure.com:443/
    const url = `wss://${this.config.host}:${this.config.port}/`;
    this.log('info', `Connecting to Azure Cosmos DB Gremlin at ${url}`);

    const authenticator = new gremlin.driver.auth.PlainTextSaslAuthenticator(
      `/dbs/${this.config.database}/colls/${this.config.collection}`,
      this.config.primaryKey,
    );

    const { Client } = gremlin.driver;
    this.client = new Client(url, {
      authenticator,
      traversalSource: 'g',
      rejectUnauthorized: false,
      mimeType: 'application/vnd.gremlin-v2.0+json',
    });

    await (this.client as { open(): Promise<void> }).open();
    this.log('info', 'Connected to Azure Cosmos DB Gremlin API');
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
    if (!this.client) throw new Error('Not connected to Azure Cosmos DB');
    const start = Date.now();

    return this.withRetry(async () => {
      const rs = await this.withTimeout(
        (this.client as { submit(q: string, b: Record<string, unknown>): Promise<unknown> })
          .submit(query, parameters),
        this.config.queryTimeoutMs ?? 30_000,
        'CosmosDB query',
      );
      const data = (rs as { toArray(): unknown[] }).toArray() as T[];
      return { success: true, data, duration: Date.now() - start, count: data.length };
    }, 'CosmosDB query');
  }

  async introspectSchema(): Promise<SchemaInfo> {
    // Cosmos DB does not expose a schema API; labels can be inferred from data
    return { vertexLabels: [], edgeLabels: [], propertyKeys: [] };
  }

  async listGraphs(): Promise<string[]> {
    return [`${this.config.database}/${this.config.collection}`];
  }
}
