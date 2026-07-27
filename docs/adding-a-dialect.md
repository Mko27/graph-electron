# Adding a New Query Dialect

Dialects are stateless classes. Adding one takes about 20 minutes.

---

## Step 1 — Add to the QueryDialect union

**File:** `packages/core/src/graph/types/IConnectionConfig.ts`

```typescript
export type QueryDialect =
  | 'gremlin'
  | 'cypher'
  | 'opencypher'
  | 'ngql'
  | 'graphql'
  | 'sparql'
  | 'gsql'
  | 'aql';    // ← add your dialect here (ArangoDB Query Language example)
```

---

## Step 2 — Implement the dialect

**Create:** `packages/core/src/graph/dialects/AQLDialect.ts`

```typescript
import type { IQueryDialect, DialectValidationResult } from '../types/IDialect';
import type { QueryDialect } from '../types/IConnectionConfig';

const WRITE_KEYWORDS = ['INSERT', 'UPDATE', 'REPLACE', 'REMOVE', 'UPSERT'];

export class AQLDialect implements IQueryDialect {
  readonly name: QueryDialect = 'aql';
  readonly displayName = 'AQL (ArangoDB Query Language)';
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

    const upper = trimmed.toUpperCase();
    if (!upper.startsWith('FOR') && !upper.startsWith('RETURN') &&
        !upper.startsWith('LET') && !WRITE_KEYWORDS.some((kw) => upper.startsWith(kw))) {
      warnings.push('AQL queries typically start with FOR, RETURN, LET, or a write keyword');
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
    // AQL: add LIMIT before RETURN
    return normalized.replace(/\bRETURN\b/i, `LIMIT ${limit} RETURN`);
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
```

---

## Step 3 — Export from the dialects barrel

**File:** `packages/core/src/graph/dialects/index.ts`

```typescript
// ...existing exports...
export { AQLDialect } from './AQLDialect';
```

---

## Step 4 — Register in the factory

**File:** `packages/core/src/graph/factory/ConnectionFactory.ts`

```typescript
import { AQLDialect } from '../dialects/AQLDialect';

const DIALECT_CATALOG = [
  new GremlinDialect(),
  new CypherDialect(),
  new OpenCypherDialect(),
  new NGQLDialect(),
  new SPARQLDialect(),
  new AQLDialect(),    // ← add here
];
```

---

## Step 5 — Update DIALECT_COMPATIBILITY for the relevant provider

**File:** `packages/core/src/graph/types/IConnectionConfig.ts`

```typescript
export const DIALECT_COMPATIBILITY: Record<DatabaseType, QueryDialect[]> = {
  // ...
  arangodb: ['graphql', 'gremlin', 'aql'],  // ← add 'aql'
};
```

---

## Step 6 — Update shared constants

**File:** `packages/shared/src/constants/index.ts`

```typescript
export const DIALECT_LABELS: Record<string, string> = {
  // ...
  aql: 'AQL (ArangoDB)',
};
```

---

## Checklist

- [ ] `QueryDialect` union updated
- [ ] `packages/core/src/graph/dialects/<Name>Dialect.ts` created
- [ ] Exported from `dialects/index.ts`
- [ ] Added to `DIALECT_CATALOG` in `ConnectionFactory.ts`
- [ ] Added to `DIALECT_COMPATIBILITY` for the relevant DB type(s)
- [ ] `DIALECT_LABELS` updated in `packages/shared`
