import type { IQueryDialect } from '../types/IDialect';
import type { QueryDialect } from '../types/IConnectionConfig';

/**
 * Global registry for query dialects.
 *
 * Dialects register themselves on module load.
 * New dialects (e.g. a future AQL for ArangoDB) are added by calling register().
 */
export class DialectRegistry {
  private static readonly instance = new DialectRegistry();
  private readonly dialects = new Map<QueryDialect, IQueryDialect>();

  static getInstance(): DialectRegistry {
    return DialectRegistry.instance;
  }

  register(dialect: IQueryDialect): void {
    this.dialects.set(dialect.name, dialect);
  }

  resolve(name: QueryDialect): IQueryDialect {
    const dialect = this.dialects.get(name);
    if (!dialect) {
      const available = [...this.dialects.keys()].join(', ');
      throw new Error(
        `No dialect registered for "${name}". Available: ${available || '(none)'}`,
      );
    }
    return dialect;
  }

  has(name: QueryDialect): boolean {
    return this.dialects.has(name);
  }

  listAll(): Array<{ name: QueryDialect; displayName: string; fileExtension: string }> {
    return [...this.dialects.values()].map((d) => ({
      name: d.name,
      displayName: d.displayName,
      fileExtension: d.fileExtension,
    }));
  }
}
