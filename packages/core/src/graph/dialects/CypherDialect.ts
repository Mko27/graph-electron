import type { IQueryDialect, DialectValidationResult } from '../types/IDialect';
import type { QueryDialect } from '../types/IConnectionConfig';

const WRITE_KEYWORDS = ['CREATE', 'MERGE', 'DELETE', 'DETACH', 'SET', 'REMOVE', 'FOREACH', 'CALL'];

export class CypherDialect implements IQueryDialect {
  readonly name: QueryDialect = 'cypher';
  readonly displayName = 'Cypher';
  readonly fileExtension = '.cypher';
  readonly commentPrefix = '//';

  validate(query: string): DialectValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const trimmed = query.trim();

    if (!trimmed) {
      errors.push('Query cannot be empty');
      return { valid: false, errors, warnings };
    }

    const upper = trimmed.toUpperCase();
    const startsWithValidClause =
      upper.startsWith('MATCH') ||
      upper.startsWith('RETURN') ||
      upper.startsWith('WITH') ||
      upper.startsWith('UNWIND') ||
      upper.startsWith('CREATE') ||
      upper.startsWith('MERGE') ||
      upper.startsWith('CALL') ||
      upper.startsWith('EXPLAIN') ||
      upper.startsWith('PROFILE') ||
      upper.startsWith('//');

    if (!startsWithValidClause) {
      warnings.push('Query does not start with a recognized Cypher clause');
    }

    if (upper.includes('DETACH DELETE') && upper.includes('MATCH ()')) {
      warnings.push('DETACH DELETE without WHERE clause will delete all nodes — confirm intent');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  normalize(query: string): string {
    // Strip single-line comments, collapse whitespace
    return query
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, '').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  addLimit(query: string, limit: number): string {
    const normalized = this.normalize(query);
    // Already has LIMIT
    if (/\bLIMIT\s+\d+/i.test(normalized)) return normalized;
    return `${normalized} LIMIT ${limit}`;
  }

  isReadOnly(query: string): boolean {
    const upper = this.normalize(query).toUpperCase();
    return !WRITE_KEYWORDS.some((kw) => {
      const regex = new RegExp(`\\b${kw}\\b`);
      return regex.test(upper);
    });
  }

  formatError(error: unknown): string {
    if (error instanceof Error) {
      // Neo4j errors have a `code` property on them
      const neo4jErr = error as Error & { code?: string };
      if (neo4jErr.code) return `[${neo4jErr.code}] ${error.message}`;
      return error.message;
    }
    return String(error);
  }
}
