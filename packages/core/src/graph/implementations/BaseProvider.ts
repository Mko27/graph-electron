import type { IGraphProvider, ConnectionState, SchemaInfo, TransactionContext } from '../types/IGraphProvider';
import type { ProviderCapabilities } from '../types/ICapabilities';
import type { ProviderConnectionConfig, QueryDialect } from '../types/IConnectionConfig';
import type { QueryResult } from '../types/IQueryResult';
import { DIALECT_COMPATIBILITY } from '../types/IConnectionConfig';

export type Logger = (level: 'info' | 'warn' | 'error' | 'debug', ...args: unknown[]) => void;

export abstract class BaseProvider implements IGraphProvider {
  abstract readonly capabilities: ProviderCapabilities;

  protected logger: Logger;

  constructor(
    public readonly id: string,
    public readonly config: ProviderConnectionConfig,
    logger?: Logger,
  ) {
    this.logger = logger ?? ((level, ...args) => console[level](`[${id}]`, ...args));
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract healthCheck(): Promise<ConnectionState>;
  abstract executeQuery<T = unknown>(
    query: string,
    dialect: QueryDialect,
    parameters?: Record<string, unknown>,
  ): Promise<QueryResult<T>>;
  abstract introspectSchema(): Promise<SchemaInfo>;
  abstract listGraphs(): Promise<string[]>;

  protected validateDialect(dialect: QueryDialect): void {
    const supported = DIALECT_COMPATIBILITY[this.config.dbType];
    if (!supported.includes(dialect)) {
      throw new Error(
        `Dialect "${dialect}" is not supported by ${this.config.dbType}. ` +
        `Supported: ${supported.join(', ')}`,
      );
    }
  }

  protected async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    const maxRetries = this.config.maxRetries ?? 3;
    const baseDelay = this.config.retryDelayMs ?? 500;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt);
          this.logger(
            'warn',
            `${operationName} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms:`,
            err instanceof Error ? err.message : err,
          );
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw lastError;
  }

  protected withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });
  }

  // Default transaction implementations for providers that don't support them
  async beginTransaction(): Promise<TransactionContext> {
    throw new Error(`${this.config.dbType} does not support explicit transactions via this provider`);
  }

  async commitTransaction(_ctx: TransactionContext): Promise<void> {
    throw new Error(`${this.config.dbType} does not support explicit transactions via this provider`);
  }

  async rollbackTransaction(_ctx: TransactionContext): Promise<void> {
    throw new Error(`${this.config.dbType} does not support explicit transactions via this provider`);
  }

  protected log(level: 'info' | 'warn' | 'error' | 'debug', ...args: unknown[]): void {
    this.logger(level, ...args);
  }
}
