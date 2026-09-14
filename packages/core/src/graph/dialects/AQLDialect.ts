import type { IQueryDialect, DialectValidationResult } from '../types/IDialect';
import type { QueryDialect } from '../types/IConnectionConfig';

/** AQL keywords that write to the database. */
const MUTATING_KEYWORDS = ['insert', 'update', 'replace', 'remove', 'upsert'];
/** Read-only entry points. */
const READ_KEYWORDS = ['for', 'return', 'let', 'with'];

/**
 * AQL — ArangoDB's own query language, and the only one the ArangoDB provider
 * actually speaks (it hands the query straight to the driver's AQL entry point).
 *
 * Before this existed the UI offered Gremlin and GraphQL for ArangoDB, neither
 * of which the provider sends, so no query could ever succeed.
 */
export class AQLDialect implements IQueryDialect {
  readonly name: QueryDialect = 'aql';
  readonly displayName = 'AQL';
  readonly fileExtension = '.aql';
  readonly commentPrefix = '//';

  validate(query: string): DialectValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const trimmed = query.trim();

    if (!trimmed) {
      errors.push('Query cannot be empty');
      return { valid: false, errors, warnings };
    }

    const lower = trimmed.toLowerCase();
    const startsWithKnown = [...READ_KEYWORDS, ...MUTATING_KEYWORDS].some((kw) =>
      new RegExp(`^${kw}\\b`).test(lower),
    );
    if (!startsWithKnown) {
      warnings.push(
        'AQL queries normally begin with FOR, RETURN, LET, WITH, INSERT, UPDATE, REPLACE, REMOVE or UPSERT',
      );
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  normalize(query: string): string {
    return query.trim().replace(/\s+/g, ' ');
  }

  addLimit(query: string, limit: number): string {
    const normalized = this.normalize(query);
    if (/\blimit\b/i.test(normalized)) return normalized;

    // LIMIT has to precede the trailing RETURN to apply to the iteration.
    const returnAt = normalized.toUpperCase().lastIndexOf('RETURN ');
    if (returnAt === -1) return normalized;
    return `${normalized.slice(0, returnAt)}LIMIT ${limit} ${normalized.slice(returnAt)}`;
  }

  isReadOnly(query: string): boolean {
    const lower = this.normalize(query).toLowerCase();
    // Word-boundary match so a collection called "updates" is not a false hit.
    const mutates = MUTATING_KEYWORDS.some((kw) => new RegExp(`\\b${kw}\\b`).test(lower));
    if (mutates) return false;
    return READ_KEYWORDS.some((kw) => new RegExp(`^${kw}\\b`).test(lower));
  }

  formatError(error: unknown): string {
    if (error instanceof Error) {
      // arangojs surfaces the server's message plus an errorNum; the first
      // line carries the useful part.
      return error.message.split('\n')[0] ?? error.message;
    }
    return String(error);
  }
}
