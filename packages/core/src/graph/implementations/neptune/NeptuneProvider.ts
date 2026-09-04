// eslint-disable-next-line @typescript-eslint/no-require-imports
const gremlin = require('gremlin');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SignatureV4 } = require('@smithy/signature-v4');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { HttpRequest } = require('@smithy/protocol-http');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Sha256 } = require('@aws-crypto/sha256-js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { defaultProvider } = require('@aws-sdk/credential-provider-node');

import type { ProviderCapabilities } from '../../types/ICapabilities';
import type { NeptuneConnectionConfig, QueryDialect } from '../../types/IConnectionConfig';
import type { ConnectionState, SchemaInfo, TransactionContext } from '../../types/IGraphProvider';
import type { QueryResult } from '../../types/IQueryResult';
import { BaseProvider, type Logger } from '../BaseProvider';
import { normalizeGremlinResult } from '../shared/gremlinResultNormalizer';
import { GREMLIN_MIME_TYPE } from '../shared/gremlinSerializer';

/** Vertices/edges sampled when introspecting the schema (see introspectSchema). */
const SCHEMA_SAMPLE_SIZE = 10_000;
/** Upper bound on how long schema introspection may take. */
const SCHEMA_TIMEOUT_MS = 15_000;

export class NeptuneProvider extends BaseProvider {
  readonly capabilities: ProviderCapabilities = {
    supportsTransactions: false,
    supportsSchema: true,
    supportsMultiGraph: false,
    supportsStreaming: false,
    supportsGremlin: true,
    supportsCypher: false,
    supportsOpenCypher: true,
    supportsNGQL: false,
    supportsSPARQL: true, // Neptune Analytics supports SPARQL
    supportsGraphQL: false,
    supportsBulkLoad: true,
    supportsPropertyGraph: true,
    supportsRDFGraph: true,
    maxConnectionsPerPool: 5,
  };

  private client: unknown = null;
  private credentialProvider: unknown = null;

  constructor(
    id: string,
    public override readonly config: NeptuneConnectionConfig,
    logger?: Logger,
  ) {
    super(id, config, logger);
  }

  async connect(): Promise<void> {
    await this.disconnect();

    const protocol = this.config.ssl ? 'wss' : 'ws';
    const url = `${protocol}://${this.config.host}:${this.config.port}/gremlin`;
    this.log('info', `Connecting to Neptune at ${url}`);

    const { Client } = gremlin.driver;
    let headers: Record<string, string> = {};

    if (this.config.ssl && this.config.useIamAuth !== false) {
      try {
        headers = await this._getSignedHeaders();
        this.log('info', 'Using IAM SigV4 authentication');
      } catch (err) {
        // A profile was explicitly requested (e.g. an AWS SSO profile) — surface the
        // failure instead of silently connecting unauthenticated, since that would
        // otherwise show up as a confusing WebSocket handshake error further down.
        if (this.config.profile) {
          throw new Error(
            `Failed to resolve AWS credentials for profile "${this.config.profile}": ${(err as Error).message}. ` +
            `If this is an SSO profile, its session may have expired — run "aws sso login --profile ${this.config.profile}" and try again.`,
          );
        }
        this.log('warn', `SigV4 signing failed, connecting without IAM auth: ${(err as Error).message}`);
      }
    }

    this.client = new Client(url, {
      traversalSource: this.config.traversalSource ?? 'g',
      mimeType: GREMLIN_MIME_TYPE,
      pingEnabled: false,
      headers,
    });

    await this.withTimeout(
      (this.client as { open(): Promise<void> }).open(),
      this.config.connectionTimeoutMs ?? 15_000,
      'Neptune connect',
    );

    this.log('info', `Connected to Neptune at ${url}`);
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;
    this.log('info', 'Disconnecting from Neptune');
    try {
      // close() returns a promise. Not awaiting it reports "disconnected"
      // while the socket is still closing, so a reconnect stacks a new link on
      // top of the old one and quitting can cut it off mid-close.
      await (this.client as { close(): Promise<void> | void }).close();
    } catch (err) {
      this.log('error', 'Error during disconnect:', (err as Error).message);
    }
    this.client = null;
  }

  async healthCheck(): Promise<ConnectionState> {
    if (!this.client) return { connected: false };
    const start = Date.now();
    try {
      await this.withTimeout(
        this._submitRaw('g.V().limit(1).count()'),
        5_000,
        'healthCheck',
      );
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
    if (!this.client) throw new Error('Not connected to Neptune');

    const start = Date.now();

    this.validateQuery(query, dialect);

    if (dialect === 'opencypher') {
      return this.withQueryRetry(
        query,
        dialect,
        () => this._executeOpenCypher<T>(query, parameters, start),
        'openCypher query',
      );
    }

    return this.withQueryRetry(query, dialect, async () => {
      const resultSet = await this.withTimeout(
        this._submitRaw(query, parameters),
        this.config.queryTimeoutMs ?? 30_000,
        'query',
      );
      const raw = (resultSet as { toArray(): unknown[] }).toArray();
      const data = raw.map((v) => normalizeGremlinResult(v)) as T[];
      return {
        success: true,
        data,
        duration: Date.now() - start,
        count: data.length,
      };
    }, 'Gremlin query');
  }

  async introspectSchema(): Promise<SchemaInfo> {
    if (!this.client) throw new Error('Not connected to Neptune');

    // These traversals used to be unbounded and untimed, so simply connecting
    // launched four full scans of every vertex and edge — slow and expensive on
    // a production graph. Sample a bounded prefix instead and cap the wait.
    const sample = SCHEMA_SAMPLE_SIZE;
    const timeoutMs = Math.min(this.config.queryTimeoutMs ?? 30_000, SCHEMA_TIMEOUT_MS);

    const collect = (traversal: string) =>
      this.withTimeout(
        this._submitRaw(traversal).then((rs) => (rs as { toArray(): unknown[] }).toArray()),
        timeoutMs,
        'Neptune schema introspection',
      );

    // Failures propagate: returning an empty schema here made a broken or
    // timed-out introspection indistinguishable from a genuinely empty graph.
    const [vLabels, eLabels, vProps, eProps] = await Promise.all([
      collect(`g.V().limit(${sample}).label().dedup()`),
      collect(`g.E().limit(${sample}).label().dedup()`),
      collect(`g.V().limit(${sample}).properties().key().dedup()`),
      collect(`g.E().limit(${sample}).properties().key().dedup()`),
    ]);

    const propKeySet = new Set([...vProps as string[], ...eProps as string[]]);

    return {
      vertexLabels: (vLabels as string[]).map((label) => ({ label, properties: [] })),
      edgeLabels: (eLabels as string[]).map((label) => ({ label, properties: [] })),
      propertyKeys: [...propKeySet].map((name) => ({ name, dataType: 'unknown' })),
    };
  }

  async listGraphs(): Promise<string[]> {
    // Neptune is single-graph; the graph name is derived from the endpoint
    return [this.config.host];
  }

  // Neptune does not support multi-statement transactions via Gremlin WebSocket
  async beginTransaction(): Promise<TransactionContext> {
    throw new Error('Neptune does not support explicit transactions via Gremlin WebSocket. Use Neptune Analytics for transaction support.');
  }

  async commitTransaction(_ctx: TransactionContext): Promise<void> {
    throw new Error('Neptune does not support explicit transactions');
  }

  async rollbackTransaction(_ctx: TransactionContext): Promise<void> {
    throw new Error('Neptune does not support explicit transactions');
  }

  private _submitRaw(query: string, bindings: Record<string, unknown> = {}): Promise<unknown> {
    return (this.client as {
      submit(q: string, b: Record<string, unknown>): Promise<unknown>;
    }).submit(query, bindings);
  }

  private async _executeOpenCypher<T>(
    query: string,
    parameters: Record<string, unknown>,
    start: number,
  ): Promise<QueryResult<T>> {
    // Neptune openCypher uses an HTTP endpoint, not the WebSocket
    const protocol = this.config.ssl ? 'https' : 'http';
    const url = `${protocol}://${this.config.host}:${this.config.port}/openCypher`;

    const body = JSON.stringify({ query, parameters });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (this.config.ssl && this.config.useIamAuth !== false) {
      const signedHeaders = await this._getSignedHeadersForPath('/openCypher', body);
      Object.assign(headers, signedHeaders);
    }

    // Without an abort signal this request had no timeout at all, so a hanging
    // openCypher query hung the tab indefinitely.
    const timeoutMs = this.config.queryTimeoutMs ?? 30_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`Neptune openCypher query timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Neptune openCypher request failed (${response.status}): ${text}`);
    }

    // Neptune's openCypher endpoint returns { results: [ {...row}, ... ] }.
    // Reading it as the SPARQL-shaped results.bindings yielded undefined, which
    // then fell back to [] — turning a shape mismatch into a silent "0 rows".
    const json = await response.json() as { results?: unknown };
    const raw = json.results;

    let data: unknown[];
    if (Array.isArray(raw)) {
      data = raw;
    } else if (raw && Array.isArray((raw as { bindings?: unknown[] }).bindings)) {
      // SPARQL-shaped payload — accepted for completeness.
      data = (raw as { bindings: unknown[] }).bindings;
    } else if (raw == null) {
      throw new Error(
        'Neptune openCypher returned no "results" field — unexpected response shape',
      );
    } else {
      throw new Error(
        `Neptune openCypher returned an unexpected "results" shape (${typeof raw})`,
      );
    }

    return {
      success: true,
      data: data as T[],
      duration: Date.now() - start,
      count: data.length,
    };
  }

  private _extractRegion(): string {
    const match = this.config.host.match(/\.([a-z]{2}-[a-z]+-\d)\.neptune\.amazonaws\.com/);
    return match?.[1] ?? 'us-east-1';
  }

  private async _getSignedHeaders(): Promise<Record<string, string>> {
    return this._getSignedHeadersForPath('/gremlin');
  }

  private async _getSignedHeadersForPath(
    path: string,
    body?: string,
  ): Promise<Record<string, string>> {
    const region = this.config.region ?? this._extractRegion();
    const request = new HttpRequest({
      method: body ? 'POST' : 'GET',
      protocol: 'https:',
      hostname: this.config.host,
      port: this.config.port,
      path,
      headers: { host: `${this.config.host}:${this.config.port}` },
      body,
    });

    if (!this.credentialProvider) {
      this.credentialProvider = defaultProvider(
        this.config.profile ? { profile: this.config.profile } : undefined,
      );
    }

    const signer = new SignatureV4({
      credentials: this.credentialProvider,
      region,
      service: 'neptune-db',
      sha256: Sha256,
    });

    const signed = await signer.sign(request);
    return signed.headers as Record<string, string>;
  }
}
