import type { QueryDialect } from './IConnectionConfig';

export interface DialectValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface IQueryDialect {
  readonly name: QueryDialect;
  readonly displayName: string;
  readonly fileExtension: string;
  readonly commentPrefix: string;

  validate(query: string): DialectValidationResult;
  normalize(query: string): string;
  addLimit(query: string, limit: number): string;
  isReadOnly(query: string): boolean;
  formatError(error: unknown): string;
}
