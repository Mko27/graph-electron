import { describe, it, expect } from 'vitest';
import { validateQuery } from '../queryHandlers';

describe('validateQuery', () => {
  const valid = { id: 'conn-1', query: 'g.V().limit(10)' };

  it('accepts a valid payload', () => {
    expect(validateQuery(valid)).toBeNull();
  });

  it('accepts query with dialect', () => {
    expect(validateQuery({ ...valid, dialect: 'gremlin' })).toBeNull();
  });

  it('rejects null', () => {
    expect(validateQuery(null)).toBe('request body is required');
  });

  it('rejects non-object', () => {
    expect(validateQuery('query')).toBe('request body is required');
  });

  it('rejects missing id', () => {
    expect(validateQuery({ query: 'g.V()' })).toMatch('id');
  });

  it('rejects numeric id', () => {
    expect(validateQuery({ ...valid, id: 1 })).toMatch('id');
  });

  it('rejects missing query', () => {
    expect(validateQuery({ id: 'conn-1' })).toMatch('query');
  });

  it('rejects empty query string', () => {
    expect(validateQuery({ id: 'conn-1', query: '' })).toMatch('query');
  });

  it('rejects whitespace-only query', () => {
    expect(validateQuery({ id: 'conn-1', query: '   \t\n' })).toMatch('query');
  });

  it('rejects numeric query', () => {
    expect(validateQuery({ id: 'conn-1', query: 42 })).toMatch('query');
  });
});
