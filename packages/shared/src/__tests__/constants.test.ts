import { describe, it, expect } from 'vitest';
import {
  DIALECT_COMPATIBILITY,
  PROVIDER_CAPABILITIES,
  DEFAULT_PORTS,
  DB_TYPE_LABELS,
  DIALECT_LABELS,
  IpcChannels,
} from '../index';

const ALL_DB_TYPES = ['neptune', 'neo4j', 'janusgraph', 'arangodb', 'cosmosdb', 'orientdb', 'tigergraph', 'nebula', 'tinkerpop'];

describe('DIALECT_COMPATIBILITY', () => {
  it('covers all DB types', () => {
    for (const t of ALL_DB_TYPES) {
      expect(DIALECT_COMPATIBILITY[t], `missing ${t}`).toBeDefined();
      expect(DIALECT_COMPATIBILITY[t].length).toBeGreaterThan(0);
    }
  });

  it('neptune supports gremlin and opencypher', () => {
    expect(DIALECT_COMPATIBILITY.neptune).toContain('gremlin');
    expect(DIALECT_COMPATIBILITY.neptune).toContain('opencypher');
  });

  it('neo4j supports cypher', () => {
    expect(DIALECT_COMPATIBILITY.neo4j).toContain('cypher');
  });
});

describe('PROVIDER_CAPABILITIES', () => {
  it('covers all DB types', () => {
    for (const t of ALL_DB_TYPES) {
      const cap = PROVIDER_CAPABILITIES[t];
      expect(cap, `missing ${t}`).toBeDefined();
      expect(typeof cap.supportsSchema).toBe('boolean');
      expect(typeof cap.supportsTransactions).toBe('boolean');
      expect(typeof cap.supportsMultiGraph).toBe('boolean');
      expect(typeof cap.supportsStreaming).toBe('boolean');
    }
  });

  it('neptune does not support transactions', () => {
    expect(PROVIDER_CAPABILITIES.neptune.supportsTransactions).toBe(false);
  });

  it('neo4j supports schema and transactions', () => {
    expect(PROVIDER_CAPABILITIES.neo4j.supportsSchema).toBe(true);
    expect(PROVIDER_CAPABILITIES.neo4j.supportsTransactions).toBe(true);
  });
});

describe('DEFAULT_PORTS', () => {
  it('covers all DB types', () => {
    for (const t of ALL_DB_TYPES) {
      expect(DEFAULT_PORTS[t], `missing port for ${t}`).toBeGreaterThan(0);
    }
  });

  it('neptune defaults to 8182', () => {
    expect(DEFAULT_PORTS.neptune).toBe(8182);
  });

  it('neo4j defaults to 7687', () => {
    expect(DEFAULT_PORTS.neo4j).toBe(7687);
  });
});

describe('DB_TYPE_LABELS', () => {
  it('has a display label for every DB type', () => {
    for (const t of ALL_DB_TYPES) {
      expect(DB_TYPE_LABELS[t], `missing label for ${t}`).toBeTruthy();
    }
  });
});

describe('DIALECT_LABELS', () => {
  const dialects = ['gremlin', 'cypher', 'opencypher', 'ngql', 'graphql', 'sparql', 'gsql'];
  it('has a label for every dialect', () => {
    for (const d of dialects) {
      expect(DIALECT_LABELS[d], `missing label for ${d}`).toBeTruthy();
    }
  });
});

describe('IpcChannels', () => {
  it('has all graph channels', () => {
    expect(IpcChannels.GRAPH_CONNECT).toBeDefined();
    expect(IpcChannels.GRAPH_DISCONNECT).toBeDefined();
    expect(IpcChannels.GRAPH_QUERY).toBeDefined();
    expect(IpcChannels.GRAPH_SCHEMA).toBeDefined();
    expect(IpcChannels.GRAPH_PROVIDERS).toBeDefined();
    expect(IpcChannels.GRAPH_HEALTH).toBeDefined();
    expect(IpcChannels.GRAPH_CONNECTIONS).toBeDefined();
    expect(IpcChannels.GRAPH_LIST_GRAPHS).toBeDefined();
  });

  it('has all dynamo channels', () => {
    expect(IpcChannels.DYNAMO_CONFIGURE).toBeDefined();
    expect(IpcChannels.DYNAMO_GET_CONFIG).toBeDefined();
    expect(IpcChannels.DYNAMO_FETCH_ITEM).toBeDefined();
  });

  it('channel values are unique strings', () => {
    const values = Object.values(IpcChannels);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
    for (const v of values) {
      expect(typeof v).toBe('string');
    }
  });
});
