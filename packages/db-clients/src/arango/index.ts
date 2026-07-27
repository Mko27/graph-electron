/**
 * ArangoHttpClient — raw transport layer for ArangoDB.
 *
 * Wraps the arangojs Database connection.
 * Does NOT: transform results, handle retries, or manage schema.
 * Install: npm install arangojs
 */

let ArangoDatabase: unknown = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ArangoDatabase = require('arangojs').Database;
} catch { /* optional dependency */ }

export interface ArangoClientOptions {
  host: string;
  port: number;
  ssl: boolean;
  database?: string;
  username?: string;
  password?: string;
  useBearerAuth?: boolean;
  token?: string;
}

export class ArangoHttpClient {
  private db: unknown = null;

  constructor(private readonly opts: ArangoClientOptions) {}

  get isOpen(): boolean {
    return this.db !== null;
  }

  async open(): Promise<void> {
    if (!ArangoDatabase) throw new Error('arangojs is not installed. Run: npm install arangojs');
    const proto = this.opts.ssl ? 'https' : 'http';
    const url = `${proto}://${this.opts.host}:${this.opts.port}`;
    const DbClass = ArangoDatabase as new (opts: object) => unknown;
    this.db = new DbClass({
      url,
      databaseName: this.opts.database ?? '_system',
      auth: this.opts.useBearerAuth
        ? { token: this.opts.token ?? '' }
        : { username: this.opts.username ?? 'root', password: this.opts.password ?? '' },
    });
    await (this.db as { version(): Promise<unknown> }).version();
  }

  close(): void {
    this.db = null;
  }

  async query(queryString: string, bindVars: Record<string, unknown> = {}): Promise<unknown[]> {
    if (!this.db) throw new Error('Arango client is not open');
    const cursor = await (this.db as {
      query(q: string, b: Record<string, unknown>): Promise<{ all(): Promise<unknown[]> }>;
    }).query(queryString, bindVars);
    return cursor.all();
  }

  async listGraphs(): Promise<string[]> {
    if (!this.db) return [];
    const graphs = await (this.db as {
      listGraphs(): Promise<Array<{ name: string }>>;
    }).listGraphs();
    return graphs.map((g) => g.name);
  }
}
