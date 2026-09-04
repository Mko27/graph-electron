/**
 * Neo4jBoltClient — raw transport layer for Neo4j.
 *
 * Wraps the neo4j-driver bolt connection.
 * Does NOT: transform results, handle retries, or manage schema.
 * Install: npm install neo4j-driver
 */

let driver: typeof import('neo4j-driver') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  driver = require('neo4j-driver');
} catch { /* optional dependency */ }

export interface Neo4jClientOptions {
  host: string;
  port: number;
  ssl: boolean;
  username: string;
  password: string;
  database?: string;
  trustStrategy?: string;
  maxPoolSize?: number;
  connectionTimeoutMs?: number;
}

export class Neo4jBoltClient {
  private d: unknown = null;

  constructor(private readonly opts: Neo4jClientOptions) {}

  get isOpen(): boolean {
    return this.d !== null;
  }

  async open(): Promise<void> {
    if (!driver) throw new Error('neo4j-driver is not installed. Run: npm install neo4j-driver');
    // Encryption goes in the URL scheme OR the config, never both: the driver
    // throws "Encryption/trust can only be configured either through URL or
    // config, not both". (Same defect as NeptuneProvider's Neo4j sibling had.)
    const proto = !this.opts.ssl
      ? 'neo4j'
      : this.opts.trustStrategy === 'TRUST_ALL_CERTIFICATES'
        ? 'neo4j+ssc'
        : 'neo4j+s';
    const uri = `${proto}://${this.opts.host}:${this.opts.port}`;
    const auth = driver.auth.basic(this.opts.username, this.opts.password);
    this.d = driver.driver(uri, auth, {
      connectionTimeout: this.opts.connectionTimeoutMs ?? 15_000,
      maxConnectionPoolSize: this.opts.maxPoolSize ?? 10,
    });
    await (this.d as { verifyConnectivity(): Promise<unknown> }).verifyConnectivity();
  }

  async close(): Promise<void> {
    if (!this.d) return;
    await (this.d as { close(): Promise<void> }).close().catch(() => undefined);
    this.d = null;
  }

  session(database?: string): unknown {
    if (!this.d) throw new Error('Neo4j client is not open');
    return (this.d as { session(cfg?: object): unknown }).session({
      database: database ?? this.opts.database ?? 'neo4j',
    });
  }
}
