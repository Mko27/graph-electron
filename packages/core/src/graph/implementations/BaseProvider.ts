import type { IGraphProvider, ConnectionState, SchemaInfo, TransactionContext } from '../types/IGraphProvider';
import type { ProviderCapabilities } from '../types/ICapabilities';
import type { ProviderConnectionConfig, QueryDialect } from '../types/IConnectionConfig';
import type { QueryResult } from '../types/IQueryResult';
import type { IQueryDialect } from '../types/IDialect';
import { DIALECT_COMPATIBILITY } from '../types/IConnectionConfig';
import { DialectRegistry } from '../registry/DialectRegistry';

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

  /**
   * The dialect handler for a query language, or null when none is registered
   * (e.g. GSQL / GraphQL, which have no handler yet). Callers must cope with
   * null rather than assuming a handler exists.
   */
  protected resolveDialect(dialect: QueryDialect): IQueryDialect | null {
    const registry = DialectRegistry.getInstance();
    return registry.has(dialect) ? registry.resolve(dialect) : null;
  }

  /**
   * True only when the dialect can positively confirm the query does not
   * mutate data.
   *
   * Deliberately fails closed: an unrecognised dialect, an unparseable query
   * or anything the handler is unsure about counts as a possible write, so it
   * will not be retried.
   */
  protected isReadOnlyQuery(query: string, dialect: QueryDialect): boolean {
    try {
      return this.resolveDialect(dialect)?.isReadOnly(query) ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Reject a query the dialect knows to be malformed, before it reaches the
   * server. Warnings are logged; only hard errors throw.
   */
  protected validateQuery(query: string, dialect: QueryDialect): void {
    const handler = this.resolveDialect(dialect);
    if (!handler) return;

    const result = handler.validate(query);
    for (const warning of result.warnings) {
      this.log('warn', `${handler.displayName} query warning: ${warning}`);
    }
    if (!result.valid) {
      throw new Error(`Invalid ${handler.displayName} query: ${result.errors.join('; ')}`);
    }
  }

  /** Turn a raw driver/server error into the dialect's readable form. */
  protected formatDialectError(error: unknown, dialect: QueryDialect): string {
    try {
      const formatted = this.resolveDialect(dialect)?.formatError(error);
      if (formatted) return formatted;
    } catch {
      // fall through to the raw message
    }
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * Run a query with retries ONLY when it is known to be read-only.
   *
   * Retrying a write is not safe: a query that timed out on our side may well
   * have been applied on the server, so a second attempt applies it twice.
   * Writes therefore get exactly one attempt, and the error is surfaced.
   */
  protected async withQueryRetry<T>(
    query: string,
    dialect: QueryDialect,
    operation: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    // Errors are passed through the dialect's formatter on the way out, so the
    // UI shows the server's actual complaint rather than a wall of driver
    // stack trace. (The dialects' addLimit()/normalize() are deliberately NOT
    // applied to user queries — silently rewriting what someone typed would be
    // worse than letting an unbounded query run.)
    try {
      if (this.isReadOnlyQuery(query, dialect)) {
        return await this.withRetry(operation, operationName);
      }

      this.log(
        'debug',
        `${operationName}: single attempt (query may modify data, so it is not retried)`,
      );
      return await operation();
    } catch (err) {
      const formatted = this.formatDialectError(err, dialect);
      const original = err instanceof Error ? err.message : String(err);
      if (formatted === original) throw err;
      // `cause` is set by hand: the ES2022 Error(message, { cause }) overload
      // is not in this project's lib target.
      const wrapped = new Error(formatted);
      (wrapped as Error & { cause?: unknown }).cause = err;
      throw wrapped;
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
