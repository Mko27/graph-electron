import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import type { Logger } from '@graph-client/core';
import { DEFAULT_DYNAMO_ENVIRONMENT, DYNAMO_ENVIRONMENTS } from '@graph-client/shared';

interface DynamoConfig {
  region: string;
  tableName: string;
  endpoint: string;
  /** Named AWS profile (incl. SSO) to resolve credentials from. */
  profile: string;
  /** Environment id the current config came from — for display/logging only. */
  environment: string;
}

interface ConfigureOptions {
  region?: string;
  tableName?: string;
  endpoint?: string;
  profile?: string;
  environment?: string;
}

interface ConfigureResult {
  success: true;
  region: string;
  tableName: string;
  endpoint: string;
  profile: string;
  environment: string;
}

interface FetchResult {
  success: boolean;
  data?: Record<string, unknown> | null;
  message?: string;
}

/**
 * DynamoService — main-process facade for Amazon DynamoDB.
 *
 * Manages the DynamoDB client lifecycle and provides:
 *   configure() — set region, table, endpoint, profile
 *   getConfig()  — read current config
 *   fetchItem()  — fetch a single item by primary key
 *
 * Each environment (local / stage / plive) carries its own table, region,
 * endpoint and AWS profile; the renderer owns the environment map and sends the
 * resolved values here, so switching environment is a single configure() call.
 *
 * All DynamoDB logic lives here; IPC handlers delegate to this service.
 */
export class DynamoService {
  private client: DynamoDBClient | null = null;
  private docClient: DynamoDBDocumentClient | null = null;
  private config: DynamoConfig = {
    region: DYNAMO_ENVIRONMENTS[DEFAULT_DYNAMO_ENVIRONMENT].region,
    tableName: DYNAMO_ENVIRONMENTS[DEFAULT_DYNAMO_ENVIRONMENT].tableName,
    endpoint: DYNAMO_ENVIRONMENTS[DEFAULT_DYNAMO_ENVIRONMENT].endpoint,
    profile: '',
    environment: DEFAULT_DYNAMO_ENVIRONMENT,
  };

  constructor(private readonly log: Logger) {}

  private initClient(region: string, endpoint: string, profile: string): void {
    // Destroy the previous client first. Assigning over it left its keep-alive
    // sockets open for the life of the app, so every environment switch leaked
    // a connection pool.
    this._destroyClient();

    const clientConfig: { region: string; endpoint?: string; credentials?: unknown } = { region };
    if (endpoint) clientConfig.endpoint = endpoint;
    // A named profile is only meaningful against real AWS; the default chain
    // (env vars, shared config, container/instance roles) is used otherwise.
    if (profile) clientConfig.credentials = defaultProvider({ profile });
    this.client = new DynamoDBClient(clientConfig as { region: string });
    this.docClient = DynamoDBDocumentClient.from(this.client, {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.log(
      'info',
      `DynamoDB client initialized (env: ${this.config.environment}, region: ${region}, ` +
      `endpoint: ${endpoint || 'AWS default'}, profile: ${profile || 'default chain'})`,
    );
  }

  configure({ region, tableName, endpoint, profile, environment }: ConfigureOptions): ConfigureResult {
    if (region) this.config.region = region;
    if (tableName) this.config.tableName = tableName;
    if (endpoint !== undefined) this.config.endpoint = endpoint;
    if (profile !== undefined) this.config.profile = profile;
    if (environment) this.config.environment = environment;
    this.initClient(this.config.region, this.config.endpoint, this.config.profile);
    return {
      success: true,
      region: this.config.region,
      tableName: this.config.tableName,
      endpoint: this.config.endpoint,
      profile: this.config.profile,
      environment: this.config.environment,
    };
  }

  getConfig(): DynamoConfig & { initialized: boolean } {
    return { ...this.config, initialized: this.docClient !== null };
  }

  /** Release the current client's sockets. Safe to call when none exists. */
  private _destroyClient(): void {
    try {
      (this.docClient as { destroy?(): void } | null)?.destroy?.();
      (this.client as { destroy?(): void } | null)?.destroy?.();
    } catch (err) {
      this.log('warn', `DynamoDB: error releasing previous client: ${(err as Error).message}`);
    }
    this.docClient = null;
    this.client = null;
  }

  /** Called on shutdown so the app does not exit with sockets still open. */
  dispose(): void {
    this._destroyClient();
  }

  async fetchItem(id: string): Promise<FetchResult> {
    if (!this.docClient) {
      this.initClient(this.config.region, this.config.endpoint, this.config.profile);
    }

    this.log(
      'info',
      `DynamoDB: fetching id="${id}" from "${this.config.tableName}" (env: ${this.config.environment})`,
    );

    const command = new QueryCommand({
      TableName: this.config.tableName,
      KeyConditionExpression: 'id = :id',
      ExpressionAttributeValues: { ':id': id },
      Limit: 1,
    });

    const response = await this.docClient!.send(command);

    if (!response.Items || response.Items.length === 0) {
      this.log('info', `DynamoDB: no item found for id="${id}"`);
      return { success: true, data: null };
    }

    const item = response.Items[0] as Record<string, unknown>;
    this.log('info', `DynamoDB: found item with ${Object.keys(item).length} attributes`);
    return { success: true, data: item };
  }
}
