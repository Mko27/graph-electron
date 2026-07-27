/**
 * NeptuneGremlinClient — raw transport layer for Amazon Neptune.
 *
 * Responsibilities (ONLY):
 *   - Open / close a Gremlin WebSocket connection
 *   - Sign requests with AWS SigV4 when IAM auth is enabled
 *   - Submit raw query strings and return raw ResultSets
 *
 * Does NOT: transform results, handle retries, introspect schema,
 * or know anything about dialects. That is @graph-client/core's job.
 */

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

export interface NeptuneClientOptions {
  host: string;
  port: number;
  ssl: boolean;
  useIamAuth?: boolean;
  region?: string;
  traversalSource?: string;
}

export class NeptuneGremlinClient {
  private client: unknown = null;

  constructor(private readonly opts: NeptuneClientOptions) {}

  get isOpen(): boolean {
    return this.client !== null;
  }

  async open(): Promise<string> {
    const protocol = this.opts.ssl ? 'wss' : 'ws';
    const url = `${protocol}://${this.opts.host}:${this.opts.port}/gremlin`;

    let headers: Record<string, string> = {};
    if (this.opts.ssl && this.opts.useIamAuth !== false) {
      try {
        headers = await this._signedHeaders('/gremlin');
      } catch { /* proceed without IAM auth */ }
    }

    const { Client } = gremlin.driver;
    this.client = new Client(url, {
      traversalSource: this.opts.traversalSource ?? 'g',
      mimeType: 'application/json',
      pingEnabled: false,
      headers,
    });
    await (this.client as { open(): Promise<void> }).open();
    return url;
  }

  close(): void {
    if (!this.client) return;
    (this.client as { close(): void }).close();
    this.client = null;
  }

  async submit(query: string, bindings: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.client) throw new Error('Neptune client is not open');
    return (this.client as {
      submit(q: string, b: Record<string, unknown>): Promise<unknown>;
    }).submit(query, bindings);
  }

  private async _signedHeaders(path: string): Promise<Record<string, string>> {
    const region = this.opts.region ?? this._extractRegion();
    const request = new HttpRequest({
      method: 'GET',
      protocol: 'https:',
      hostname: this.opts.host,
      port: this.opts.port,
      path,
      headers: { host: `${this.opts.host}:${this.opts.port}` },
    });
    const signer = new SignatureV4({ credentials: defaultProvider(), region, service: 'neptune-db', sha256: Sha256 });
    const signed = await signer.sign(request);
    return signed.headers as Record<string, string>;
  }

  private _extractRegion(): string {
    const match = this.opts.host.match(/\.([a-z]{2}-[a-z]+-\d)\.neptune\.amazonaws\.com/);
    return match?.[1] ?? 'us-east-1';
  }
}
