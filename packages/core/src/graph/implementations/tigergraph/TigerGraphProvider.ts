// TigerGraph uses a REST++ API for queries and GSQL for schema management.
// Official SDK: npm install tigergraph-js-client (if available)
// Fallback: native fetch against REST++ endpoints.

import type { ProviderCapabilities } from '../../types/ICapabilities';
import type { TigerGraphConnectionConfig, QueryDialect } from '../../types/IConnectionConfig';
import type { ConnectionState, SchemaInfo } from '../../types/IGraphProvider';
import type { QueryResult } from '../../types/IQueryResult';
import { BaseProvider, type Logger } from '../BaseProvider';

interface TigerGraphEcho {
  version: { edition: string; api: string; schema: number };
  results: [{ message: string }];
}

export class TigerGraphProvider extends BaseProvider {
  readonly capabilities: ProviderCapabilities = {
    supportsTransactions: false,
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
    maxConnectionsPerPool: 5,
  };

  private authToken: string | null = null;

  constructor(
    id: string,
    public override readonly config: TigerGraphConnectionConfig,
    logger?: Logger,
  ) {
    super(id, config, logger);
  }

  private get baseUrl(): string {
    const proto = this.config.ssl ? 'https' : 'http';
    return `${proto}://${this.config.host}:${this.config.port}`;
  }

  async connect(): Promise<void> {
    this.log('info', `Connecting to TigerGraph at ${this.baseUrl}`);

    if (this.config.token) {
      this.authToken = this.config.token;
    } else if (this.config.username && this.config.password) {
      await this._authenticate();
    }

    // Verify connectivity
    await this._request<TigerGraphEcho>('GET', '/echo');
    this.log('info', 'Connected to TigerGraph');
  }

  async disconnect(): Promise<void> {
    this.authToken = null;
  }

  async healthCheck(): Promise<ConnectionState> {
    const start = Date.now();
    try {
      await this._request('GET', '/echo');
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
    if (!this.authToken) throw new Error('Not connected to TigerGraph');
    const start = Date.now();

    this.validateQuery(query, dialect);

    return this.withQueryRetry(query, dialect, async () => {
      // TigerGraph runs installed queries by name via REST++
      // For ad-hoc GSQL, use the GSQL server endpoint
      const graph = this.config.graphName ?? 'MyGraph';
      const path = `/query/${graph}/${query}`;
      const result = await this._request<{ results: T[] }>('GET', path);
      const data = result.results ?? [];
      return { success: true, data, duration: Date.now() - start, count: data.length };
    }, 'TigerGraph query');
  }

  async introspectSchema(): Promise<SchemaInfo> {
    const graph = this.config.graphName ?? 'MyGraph';
    try {
      const schema = await this._request<{
        VertexTypes: Array<{ Name: string; Attributes: Array<{ AttributeName: string; AttributeType: { Name: string } }> }>;
        EdgeTypes: Array<{ Name: string; Attributes: Array<{ AttributeName: string; AttributeType: { Name: string } }> }>;
      }>('GET', `/gsqlserver/gsql/schema?graph=${graph}`);

      return {
        vertexLabels: (schema.VertexTypes ?? []).map((v) => ({
          label: v.Name,
          properties: (v.Attributes ?? []).map((a) => ({
            name: a.AttributeName,
            dataType: a.AttributeType.Name,
          })),
        })),
        edgeLabels: (schema.EdgeTypes ?? []).map((e) => ({
          label: e.Name,
          properties: (e.Attributes ?? []).map((a) => ({
            name: a.AttributeName,
            dataType: a.AttributeType.Name,
          })),
        })),
        propertyKeys: [],
      };
    } catch {
      return { vertexLabels: [], edgeLabels: [], propertyKeys: [] };
    }
  }

  async listGraphs(): Promise<string[]> {
    try {
      const result = await this._request<{ graphs: string[] }>('GET', '/graphs');
      return result.graphs ?? [];
    } catch {
      return [this.config.graphName ?? this.config.host];
    }
  }

  private async _authenticate(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/requesttoken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: this.config.graphName,
        secret: this.config.secret ?? '',
        lifetime: 3600,
      }),
    });
    const json = await response.json() as { token?: string; results?: { token: string }[] };
    this.authToken = json.token ?? json.results?.[0]?.token ?? null;
    if (!this.authToken) throw new Error('TigerGraph authentication failed — no token returned');
  }

  private async _request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.authToken) headers['Authorization'] = `Bearer ${this.authToken}`;

    const response = await this.withTimeout(
      fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      }),
      this.config.queryTimeoutMs ?? 30_000,
      `TigerGraph ${method} ${path}`,
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`TigerGraph REST++ error (${response.status}): ${text}`);
    }

    return response.json() as Promise<T>;
  }
}
