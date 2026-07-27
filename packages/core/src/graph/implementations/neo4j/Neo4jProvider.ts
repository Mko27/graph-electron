// neo4j-driver is an optional dependency — import guard prevents startup crash
// if it hasn't been installed yet. Run: npm install neo4j-driver
let neo4jDriver: typeof import('neo4j-driver') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  neo4jDriver = require('neo4j-driver');
} catch {
  // Provider will throw a helpful message when connect() is called
}

import type { ProviderCapabilities } from '../../types/ICapabilities';
import type { Neo4jConnectionConfig, QueryDialect } from '../../types/IConnectionConfig';
import type { ConnectionState, SchemaInfo, TransactionContext } from '../../types/IGraphProvider';
import type { QueryResult } from '../../types/IQueryResult';
import { BaseProvider, type Logger } from '../BaseProvider';

interface Neo4jRecord {
  keys: string[];
  get(key: string): unknown;
  toObject(): Record<string, unknown>;
}

interface Neo4jSummary {
  counters: { updates(): Record<string, number> };
  resultAvailableAfter: { toNumber(): number };
  resultConsumedAfter: { toNumber(): number };
}

interface Neo4jSession {
  run(query: string, params?: Record<string, unknown>): {
    records(): Promise<Neo4jRecord[]>;
    summary(): Promise<Neo4jSummary>;
  };
  beginTransaction(): Neo4jTx;
  close(): Promise<void>;
}

interface Neo4jTx {
  run(query: string, params?: Record<string, unknown>): Promise<{
    records: Neo4jRecord[];
    summary: Neo4jSummary;
  }>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

interface Neo4jDriverInstance {
  session(config?: { database?: string }): Neo4jSession;
  verifyConnectivity(): Promise<{ address: string }>;
  close(): Promise<void>;
}

export class Neo4jProvider extends BaseProvider {
  readonly capabilities: ProviderCapabilities = {
    supportsTransactions: true,
    supportsSchema: true,
    supportsMultiGraph: true,
    supportsStreaming: false,
    supportsGremlin: false,
    supportsCypher: true,
    supportsOpenCypher: false,
    supportsNGQL: false,
    supportsSPARQL: false,
    supportsGraphQL: false,
    supportsBulkLoad: false,
    supportsPropertyGraph: true,
    supportsRDFGraph: false,
    maxConnectionsPerPool: 10,
  };

  private driver: Neo4jDriverInstance | null = null;
  private activeTxMap = new Map<string, Neo4jTx>();

  constructor(
    id: string,
    public override readonly config: Neo4jConnectionConfig,
    logger?: Logger,
  ) {
    super(id, config, logger);
  }

  async connect(): Promise<void> {
    if (!neo4jDriver) {
      throw new Error(
        'neo4j-driver is not installed. Run: npm install neo4j-driver',
      );
    }

    const protocol = this.config.ssl ? 'neo4j+s' : 'neo4j';
    const uri = `${protocol}://${this.config.host}:${this.config.port}`;

    this.log('info', `Connecting to Neo4j at ${uri}`);

    const auth = neo4jDriver.auth.basic(this.config.username, this.config.password);
    this.driver = neo4jDriver.driver(uri, auth, {
      encrypted: this.config.ssl,
      trust: this.config.trustStrategy ?? 'TRUST_SYSTEM_CA_SIGNED_CERTIFICATES',
      connectionTimeout: this.config.connectionTimeoutMs ?? 15_000,
      maxConnectionPoolSize: this.config.poolMax ?? 10,
    }) as unknown as Neo4jDriverInstance;

    await this.withTimeout(
      this.driver.verifyConnectivity(),
      this.config.connectionTimeoutMs ?? 15_000,
      'Neo4j connect',
    );

    this.log('info', `Connected to Neo4j at ${uri}`);
  }

  async disconnect(): Promise<void> {
    if (!this.driver) return;
    this.log('info', 'Disconnecting from Neo4j');
    await this.driver.close().catch(() => undefined);
    this.driver = null;
  }

  async healthCheck(): Promise<ConnectionState> {
    if (!this.driver) return { connected: false };
    const start = Date.now();
    try {
      await this.withTimeout(this.driver.verifyConnectivity(), 5_000, 'Neo4j healthCheck');
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
    if (!this.driver) throw new Error('Not connected to Neo4j');

    const start = Date.now();

    return this.withRetry(async () => {
      const session = this.driver!.session({
        database: this.config.database ?? 'neo4j',
      });

      try {
        const result = session.run(query, parameters);
        const [records, summary] = await Promise.all([
          result.records(),
          result.summary(),
        ]);

        const data = records.map((r) => this._recordToObject(r)) as T[];
        const availableAfter = summary.resultAvailableAfter.toNumber();

        return {
          success: true,
          data,
          duration: Date.now() - start,
          count: data.length,
          metadata: {
            profile: { planningTimeMs: availableAfter },
          },
        };
      } finally {
        await session.close();
      }
    }, 'Neo4j query');
  }

  async introspectSchema(): Promise<SchemaInfo> {
    if (!this.driver) throw new Error('Not connected to Neo4j');

    const session = this.driver.session({ database: this.config.database ?? 'neo4j' });
    try {
      const [labelsResult, relTypesResult, propKeysResult] = await Promise.all([
        session.run('CALL db.labels() YIELD label RETURN label').records(),
        session.run('CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType').records(),
        session.run('CALL db.propertyKeys() YIELD propertyKey RETURN propertyKey').records(),
      ]);

      return {
        vertexLabels: labelsResult.map((r) => ({
          label: r.get('label') as string,
          properties: [],
        })),
        edgeLabels: relTypesResult.map((r) => ({
          label: r.get('relationshipType') as string,
          properties: [],
        })),
        propertyKeys: propKeysResult.map((r) => ({
          name: r.get('propertyKey') as string,
          dataType: 'unknown',
        })),
      };
    } finally {
      await session.close();
    }
  }

  async listGraphs(): Promise<string[]> {
    if (!this.driver) throw new Error('Not connected to Neo4j');
    const session = this.driver.session();
    try {
      const records = await session
        .run('SHOW DATABASES YIELD name, currentStatus WHERE currentStatus = "online" RETURN name')
        .records();
      return records.map((r) => r.get('name') as string);
    } catch {
      // Neo4j Community edition doesn't support SHOW DATABASES
      return [this.config.database ?? 'neo4j'];
    } finally {
      await session.close();
    }
  }

  async beginTransaction(): Promise<TransactionContext> {
    if (!this.driver) throw new Error('Not connected to Neo4j');
    const session = this.driver.session({ database: this.config.database ?? 'neo4j' });
    const tx = session.beginTransaction();
    const ctx: TransactionContext = {
      id: `neo4j-tx-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      startTime: new Date(),
      operationCount: 0,
    };
    this.activeTxMap.set(ctx.id, tx);
    return ctx;
  }

  async commitTransaction(ctx: TransactionContext): Promise<void> {
    const tx = this.activeTxMap.get(ctx.id);
    if (!tx) throw new Error(`Transaction ${ctx.id} not found`);
    await tx.commit();
    this.activeTxMap.delete(ctx.id);
  }

  async rollbackTransaction(ctx: TransactionContext): Promise<void> {
    const tx = this.activeTxMap.get(ctx.id);
    if (!tx) throw new Error(`Transaction ${ctx.id} not found`);
    await tx.rollback();
    this.activeTxMap.delete(ctx.id);
  }

  private _recordToObject(record: Neo4jRecord): Record<string, unknown> {
    return record.toObject();
  }
}
