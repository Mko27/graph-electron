import type { IQueryDialect, DialectValidationResult } from '../types/IDialect';
import type { QueryDialect } from '../types/IConnectionConfig';

const WRITE_KEYWORDS = ['INSERT', 'UPDATE', 'UPSERT', 'DELETE', 'DROP', 'ALTER', 'CREATE'];

export class NGQLDialect implements IQueryDialect {
  readonly name: QueryDialect = 'ngql';
  readonly displayName = 'nGQL (NebulaGraph)';
  readonly fileExtension = '.ngql';
  readonly commentPrefix = '#';

  validate(query: string): DialectValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const trimmed = query.trim();

    if (!trimmed) {
      errors.push('Query cannot be empty');
      return { valid: false, errors, warnings };
    }

    // nGQL requires USE <space> before DML unless you're in a space context
    const upper = trimmed.toUpperCase();
    const hasGoFrom = upper.startsWith('GO') || upper.startsWith('FETCH') ||
                      upper.startsWith('LOOKUP') || upper.startsWith('MATCH') ||
                      upper.startsWith('FIND') || upper.startsWith('SHOW') ||
                      upper.startsWith('USE') || upper.startsWith('DESCRIBE') ||
                      upper.startsWith('DESC');

    if (!hasGoFrom && !WRITE_KEYWORDS.some((kw) => upper.startsWith(kw))) {
      warnings.push('Unrecognized nGQL clause — verify syntax for NebulaGraph');
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
