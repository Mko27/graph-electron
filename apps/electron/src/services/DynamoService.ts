import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { Logger } from '@graph-client/core';

interface DynamoConfig {
  region: string;
  tableName: string;
  endpoint: string;
}

interface ConfigureOptions {
  region?: string;
  tableName?: string;
  endpoint?: string;
}

interface ConfigureResult {
  success: true;
  region: string;
  tableName: string;
  endpoint: string;
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
 *   configure() — set region, table, endpoint
 *   getConfig()  — read current config
 *   fetchItem()  — fetch a single item by primary key
 *
 * All DynamoDB logic lives here; IPC handlers delegate to this service.
 */
export class DynamoService {
  private client: DynamoDBClient | null = null;
  private docClient: DynamoDBDocumentClient | null = null;
  private config: DynamoConfig = {
    region: 'us-east-1',
    tableName: 'development_blocks',
    endpoint: 'http://localhost:8000',
  };

  constructor(private readonly log: Logger) {}

  private initClient(region: string, endpoint: string): void {
    const clientConfig: { region: string; endpoint?: string } = { region };
    if (endpoint) clientConfig.endpoint = endpoint;
    this.client = new DynamoDBClient(clientConfig);
    this.docClient = DynamoDBDocumentClient.from(this.client, {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.log('info', `DynamoDB client initialized (region: ${region}, endpoint: ${endpoint || 'AWS default'})`);
  }

  configure({ region, tableName, endpoint }: ConfigureOptions): ConfigureResult {
    if (region) this.config.region = region;
    if (tableName) this.config.tableName = tableName;
    if (endpoint !== undefined) this.config.endpoint = endpoint;
    this.initClient(this.config.region, this.config.endpoint);
    return {
      success: true,
      region: this.config.region,
      tableName: this.config.tableName,
      endpoint: this.config.endpoint,
    };
  }

  getConfig(): DynamoConfig & { initialized: boolean } {
    return { ...this.config, initialized: this.docClient !== null };
  }

  async fetchItem(id: string): Promise<FetchResult> {
    if (!this.docClient) {
      this.initClient(this.config.region, this.config.endpoint);
    }

    this.log('info', `DynamoDB: fetching id="${id}" from "${this.config.tableName}"`);

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
