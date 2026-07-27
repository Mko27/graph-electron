import { describe, it, expect } from 'vitest';
import { validateConnect, validateId } from '../connectionHandlers';

describe('validateConnect', () => {
  const valid = {
    id: 'conn-1',
    dbType: 'neptune',
    dialect: 'gremlin',
    host: 'localhost',
    port: 8182,
  };

  it('accepts a valid config', () => {
    expect(validateConnect(valid)).toBeNull();
  });

  it('rejects null', () => {
    expect(validateConnect(null)).toBe('config is required');
  });

  it('rejects non-object', () => {
    expect(validateConnect('string')).toBe('config is required');
  });

  it('rejects missing id', () => {
    expect(validateConnect({ ...valid, id: undefined })).toMatch('id');
  });

  it('rejects numeric id', () => {
    expect(validateConnect({ ...valid, id: 123 })).toMatch('id');
  });

  it('rejects unknown dbType', () => {
    expect(validateConnect({ ...valid, dbType: 'mysql' })).toMatch('dbType');
  });

  it('rejects missing dbType', () => {
    expect(validateConnect({ ...valid, dbType: undefined })).toMatch('dbType');
  });

  it('rejects unknown dialect', () => {
    expect(validateConnect({ ...valid, dialect: 'sql' })).toMatch('dialect');
  });

  it('rejects missing host', () => {
    expect(validateConnect({ ...valid, host: '' })).toMatch('host');
  });

  it('rejects port 0', () => {
    expect(validateConnect({ ...valid, port: 0 })).toMatch('port');
  });

  it('rejects negative port', () => {
    expect(validateConnect({ ...valid, port: -1 })).toMatch('port');
  });

  it('rejects string port', () => {
    expect(validateConnect({ ...valid, port: '8182' })).toMatch('port');
  });

  it('accepts all supported dbTypes', () => {
    const types = ['neptune', 'neo4j', 'janusgraph', 'arangodb', 'cosmosdb', 'orientdb', 'tigergraph', 'nebula', 'tinkerpop'];
    for (const dbType of types) {
      const dialect = dbType === 'neo4j' ? 'cypher' : dbType === 'nebula' ? 'ngql' : 'gremlin';
      expect(validateConnect({ ...valid, dbType, dialect })).toBeNull();
    }
  });
});

describe('validateId', () => {
  it('accepts valid id payload', () => {
    expect(validateId({ id: 'conn-1' })).toBeNull();
  });

  it('rejects null', () => {
    expect(validateId(null)).toBe('id is required');
  });

  it('rejects missing id field', () => {
    expect(validateId({})).toMatch('id');
  });

  it('rejects numeric id', () => {
    expect(validateId({ id: 42 })).toMatch('id');
  });

  it('rejects empty string id', () => {
    expect(validateId({ id: '' })).toMatch('id');
  });
});
