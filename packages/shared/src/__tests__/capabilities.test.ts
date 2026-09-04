import { describe, it, expect } from 'vitest';
import { ConnectionFactory } from '@graph-client/core';
import type { ProviderConnectionConfig } from '@graph-client/core';
import {
  PROVIDER_CAPABILITIES,
  DIALECT_COMPATIBILITY,
  DB_TYPE_LABELS,
  DIALECT_LABELS,
} from '../constants';

/**
 * The renderer cannot import @graph-client/core (Electron-only dependencies),
 * so the UI capability table in constants.ts is a hand-maintained copy of what
 * each provider declares. The two drifted apart on 6 flags, which silently hid
 * the schema panel for ArangoDB, OrientDB and NebulaGraph while the docs
 * promised it.
 *
 * These tests diff the copy against the real providers so it cannot drift
 * again: if you change a provider's capabilities, this fails until the UI table
 * is updated to match.
 */

const UI_FLAGS = [
  'supportsSchema',
  'supportsTransactions',
  'supportsMultiGraph',
  'supportsStreaming',
] as const;

const DB_TYPES = Object.keys(DB_TYPE_LABELS);

/** Minimal config that satisfies every provider's required fields. */
function stubConfig(dbType: string): ProviderConnectionConfig {
  return {
    id: 'capability-probe',
    name: 'capability-probe',
    dbType,
    dialect: DIALECT_COMPATIBILITY[dbType][0],
    host: 'localhost',
    port: 1,
    ssl: false,
    username: 'u',
    password: 'p',
    primaryKey: 'k',
    database: 'd',
    collection: 'c',
  } as unknown as ProviderConnectionConfig;
}

describe('UI capability table matches the providers', () => {
  const factory = new ConnectionFactory();

  it.each(DB_TYPES)('%s declares the same UI flags in both tables', (dbType) => {
    const provider = factory.createProvider(stubConfig(dbType));
    const ui = PROVIDER_CAPABILITIES[dbType];

    expect(ui, `PROVIDER_CAPABILITIES has no entry for "${dbType}"`).toBeDefined();

    for (const flag of UI_FLAGS) {
      expect(
        ui[flag],
        `${dbType}.${flag}: UI table says ${ui[flag]}, provider says ${provider.capabilities[flag]}`,
      ).toBe(provider.capabilities[flag]);
    }
  });

  it('covers every registered provider and no extras', () => {
    expect(Object.keys(PROVIDER_CAPABILITIES).sort()).toEqual([...DB_TYPES].sort());
  });
});

describe('dialect compatibility is self-consistent', () => {
  const factory = new ConnectionFactory();

  it('lists at least one dialect per database', () => {
    for (const dbType of DB_TYPES) {
      expect(DIALECT_COMPATIBILITY[dbType]?.length, `${dbType} has no dialects`).toBeGreaterThan(0);
    }
  });

  it('every listed dialect has a display label', () => {
    for (const dbType of DB_TYPES) {
      for (const dialect of DIALECT_COMPATIBILITY[dbType]) {
        expect(DIALECT_LABELS[dialect], `no label for dialect "${dialect}"`).toBeTruthy();
      }
    }
  });

  it('every listed dialect is accepted by the provider it is listed for', () => {
    // Guards the ArangoDB class of bug: the UI offered Gremlin/GraphQL while
    // the provider only ever spoke AQL, so no query could succeed.
    for (const dbType of DB_TYPES) {
      for (const dialect of DIALECT_COMPATIBILITY[dbType]) {
        expect(
          () => factory.createProvider({ ...stubConfig(dbType), dialect } as ProviderConnectionConfig),
          `${dbType} rejects its own listed dialect "${dialect}"`,
        ).not.toThrow();
      }
    }
  });
});
