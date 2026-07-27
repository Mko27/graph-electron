import type { IQueryDialect, DialectValidationResult } from '../types/IDialect';
import type { QueryDialect } from '../types/IConnectionConfig';

const READ_ONLY_PATTERNS = [/^g\.\s*V\b/, /^g\.\s*E\b/];
const MUTATING_STEPS = [
  'addV', 'addE', 'property', 'drop', 'sideEffect', 'iterate',
];

export class GremlinDialect implements IQueryDialect {
  readonly name: QueryDialect = 'gremlin';
  readonly displayName = 'Gremlin';
  readonly fileExtension = '.gremlin';
  readonly commentPrefix = '//';

  validate(query: string): DialectValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const trimmed = query.trim();

    if (!trimmed) {
      errors.push('Query cannot be empty');
      return { valid: false, errors, warnings };
    }

    if (!trimmed.startsWith('g.')) {
      errors.push('Gremlin traversals must start with a traversal source (e.g. "g.")');
    }

    if (trimmed.includes('g.inject') || trimmed.includes('g.io')) {
      warnings.push('io() and inject() steps may have security implications');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  normalize(query: string): string {
    return query.trim().replace(/\s+/g, ' ');
  }

  addLimit(query: string, limit: number): string {
    const normalized = this.normalize(query);
    // Already has a limit step
    if (/\.limit\s*\(/.test(normalized)) return normalized;
    // Already has range
    if (/\.range\s*\(/.test(normalized)) return normalized;
    return `${normalized}.limit(${limit})`;
  }

  isReadOnly(query: string): boolean {
    const normalized = this.normalize(query).toLowerCase();
    const hasMutation = MUTATING_STEPS.some((step) => normalized.includes(`.${step}(`));
    if (hasMutation) return false;
    return READ_ONLY_PATTERNS.some((p) => p.test(normalized));
  }

  formatError(error: unknown): string {
    if (error instanceof Error) {
      // Strip Gremlin server stack trace noise
      const lines = error.message.split('\n');
      return lines[0] ?? error.message;
    }
    return String(error);
  }
}
