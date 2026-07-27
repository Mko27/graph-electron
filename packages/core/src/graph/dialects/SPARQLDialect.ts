import type { IQueryDialect, DialectValidationResult } from '../types/IDialect';
import type { QueryDialect } from '../types/IConnectionConfig';

// SPARQL is future-ready — implemented for RDF/triple stores (Neptune RDF mode, etc.)
const WRITE_KEYWORDS = ['INSERT', 'DELETE', 'CLEAR', 'DROP', 'CREATE', 'COPY', 'MOVE', 'ADD', 'LOAD'];

export class SPARQLDialect implements IQueryDialect {
  readonly name: QueryDialect = 'sparql';
  readonly displayName = 'SPARQL';
  readonly fileExtension = '.sparql';
  readonly commentPrefix = '#';

  validate(query: string): DialectValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const trimmed = query.trim();

    if (!trimmed) {
      errors.push('Query cannot be empty');
      return { valid: false, errors, warnings };
    }

    const upper = trimmed.toUpperCase();
    const validStart =
      upper.startsWith('SELECT') || upper.startsWith('CONSTRUCT') ||
      upper.startsWith('ASK') || upper.startsWith('DESCRIBE') ||
      upper.startsWith('PREFIX') || upper.startsWith('BASE') ||
      WRITE_KEYWORDS.some((kw) => upper.startsWith(kw));

    if (!validStart) {
      errors.push('SPARQL query must start with SELECT, CONSTRUCT, ASK, DESCRIBE, or an update keyword');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  normalize(query: string): string {
    return query
      .split('\n')
      .map((line) => line.replace(/#.*$/, '').trim())
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
