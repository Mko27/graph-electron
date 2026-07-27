import type { IQueryDialect, DialectValidationResult } from '../types/IDialect';
import type { QueryDialect } from '../types/IConnectionConfig';

// openCypher is a subset of Neo4j Cypher — reuse the same validation logic
// with stricter checking since openCypher omits some Neo4j-specific extensions.
const WRITE_KEYWORDS = ['CREATE', 'MERGE', 'DELETE', 'DETACH', 'SET', 'REMOVE'];

// Neo4j-only features not in the openCypher spec
const NEO4J_ONLY = [
  'CALL {', 'FOREACH', 'LOAD CSV', 'apoc.', 'gds.', ':auto', 'SHOW ',
];

export class OpenCypherDialect implements IQueryDialect {
  readonly name: QueryDialect = 'opencypher';
  readonly displayName = 'openCypher';
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
    if (!upper.startsWith('MATCH') && !upper.startsWith('RETURN') &&
        !upper.startsWith('WITH') && !upper.startsWith('CREATE') &&
        !upper.startsWith('MERGE') && !upper.startsWith('UNWIND') &&
        !upper.startsWith('//')) {
      warnings.push('Query does not start with a recognized openCypher clause');
    }

    for (const feature of NEO4J_ONLY) {
      if (trimmed.toUpperCase().includes(feature.toUpperCase())) {
        warnings.push(`"${feature}" is a Neo4j extension and may not be supported in openCypher mode`);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  normalize(query: string): string {
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
    if (/\bLIMIT\s+\d+/i.test(normalized)) return normalized;
    return `${normalized} LIMIT ${limit}`;
  }

  isReadOnly(query: string): boolean {
    const upper = this.normalize(query).toUpperCase();
    return !WRITE_KEYWORDS.some((kw) => new RegExp(`\\b${kw}\\b`).test(upper));
  }

  formatError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}
