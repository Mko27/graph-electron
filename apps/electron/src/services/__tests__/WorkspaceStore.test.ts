import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const encryptionAvailable = { value: true };

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable.value,
    // Reversible stand-in for the OS keychain — enough to prove the secrets
    // round-trip and never land in the plaintext state.
    encryptString: (text: string) => Buffer.from(`enc:${text}`, 'utf8'),
    decryptString: (buf: Buffer) => {
      const raw = buf.toString('utf8');
      if (!raw.startsWith('enc:')) throw new Error('bad ciphertext');
      return raw.slice(4);
    },
  },
}));

import { WorkspaceStore } from '../WorkspaceStore';
import type { WorkspaceState } from '@graph-client/shared';

const log = vi.fn();

let dir: string;
let file: string;

function makeStore() {
  return new WorkspaceStore(log as never, file);
}

function makeState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    version: 1,
    connections: [
      {
        id: 'conn_1',
        name: 'Stage',
        dbType: 'neo4j',
        dialect: 'cypher',
        host: 'db.example.com',
        port: 7687,
        ssl: true,
        username: 'neo4j',
        password: 's3cret',
      },
    ],
    activeConnectionId: 'conn_1',
    tabs: [
      {
        id: 'tab_1',
        name: 'Query 1',
        query: 'MATCH (n) RETURN n',
        connectionId: 'conn_1',
        activeResultTab: 'graph',
        history: [{ query: 'MATCH (n) RETURN n', success: true, timestamp: '10:00:00' }],
      },
    ],
    activeTabId: 'tab_1',
    ...overrides,
  };
}

beforeEach(() => {
  encryptionAvailable.value = true;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-store-'));
  file = path.join(dir, 'workspace.json');
  log.mockClear();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('WorkspaceStore.load', () => {
  it('reports success with no state when nothing has been saved', () => {
    const res = makeStore().load();
    expect(res.success).toBe(true);
    expect(res.state).toBeUndefined();
  });

  it('round-trips connections, tabs and settings', () => {
    const store = makeStore();
    const state = makeState({ ui: { graphLabelProperty: 'block_type' } });
    expect(store.save(state).success).toBe(true);

    const res = store.load();
    expect(res.success).toBe(true);
    expect(res.state?.connections[0].host).toBe('db.example.com');
    expect(res.state?.tabs[0].query).toBe('MATCH (n) RETURN n');
    expect(res.state?.tabs[0].activeResultTab).toBe('graph');
    expect(res.state?.tabs[0].history).toHaveLength(1);
    expect(res.state?.activeTabId).toBe('tab_1');
    expect(res.state?.ui?.graphLabelProperty).toBe('block_type');
  });

  it('ignores state written by an incompatible version', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 99, savedAt: '', state: makeState() }));
    const res = makeStore().load();
    expect(res.success).toBe(true);
    expect(res.state).toBeUndefined();
  });

  it('reports failure on a corrupt file instead of throwing', () => {
    fs.writeFileSync(file, '{ not json');
    const res = makeStore().load();
    expect(res.success).toBe(false);
    expect(res.message).toBeTruthy();
  });

  it('drops entries that are missing an id', () => {
    fs.writeFileSync(file, JSON.stringify({
      version: 1,
      savedAt: '',
      state: { version: 1, connections: [{ name: 'no id' }], tabs: [{ name: 'no id' }], activeConnectionId: null, activeTabId: null },
    }));
    const res = makeStore().load();
    expect(res.state?.connections).toHaveLength(0);
    expect(res.state?.tabs).toHaveLength(0);
  });
});

describe('WorkspaceStore secret handling', () => {
  it('keeps secrets out of the plaintext state and restores them on load', () => {
    const store = makeStore();
    store.save(makeState());

    const onDisk = fs.readFileSync(file, 'utf8');
    expect(onDisk).not.toContain('s3cret');
    expect(JSON.parse(onDisk).state.connections[0].password).toBeUndefined();
    // Non-secret fields stay readable.
    expect(JSON.parse(onDisk).state.connections[0].username).toBe('neo4j');

    expect(store.load().state?.connections[0].password).toBe('s3cret');
  });

  it('omits secrets entirely when the OS keychain is unavailable', () => {
    encryptionAvailable.value = false;
    const store = makeStore();
    store.save(makeState());

    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(parsed.secrets).toBeUndefined();
    expect(fs.readFileSync(file, 'utf8')).not.toContain('s3cret');

    const res = store.load();
    expect(res.secretsAvailable).toBe(false);
    expect(res.state?.connections[0].password).toBeUndefined();
    // The rest of the workspace still restores.
    expect(res.state?.connections[0].name).toBe('Stage');
  });

  it('survives secrets it cannot decrypt', () => {
    const store = makeStore();
    store.save(makeState());

    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    parsed.secrets = Buffer.from('garbage', 'utf8').toString('base64');
    fs.writeFileSync(file, JSON.stringify(parsed));

    const res = store.load();
    expect(res.success).toBe(true);
    expect(res.state?.connections[0].password).toBeUndefined();
    expect(res.state?.connections[0].name).toBe('Stage');
  });
});

describe('WorkspaceStore.save', () => {
  it('leaves no temp file behind', () => {
    makeStore().save(makeState());
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    expect(fs.existsSync(file)).toBe(true);
  });

  it('creates the parent directory when missing', () => {
    const nested = path.join(dir, 'a', 'b', 'workspace.json');
    const store = new WorkspaceStore(log as never, nested);
    expect(store.save(makeState()).success).toBe(true);
    expect(fs.existsSync(nested)).toBe(true);
  });

  it('overwrites the previous save rather than appending', () => {
    const store = makeStore();
    store.save(makeState());
    store.save(makeState({ connections: [], activeConnectionId: null }));
    expect(store.load().state?.connections).toHaveLength(0);
  });

  it('reports failure instead of throwing when the path is unwritable', () => {
    // A directory where the file should be — write must fail.
    fs.mkdirSync(path.join(dir, 'blocked.json'));
    const store = new WorkspaceStore(log as never, path.join(dir, 'blocked.json'));
    const res = store.save(makeState());
    expect(res.success).toBe(false);
    expect(res.message).toBeTruthy();
  });
});

describe('WorkspaceStore.clear', () => {
  it('removes the file and is safe to call twice', () => {
    const store = makeStore();
    store.save(makeState());
    expect(store.clear().success).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    expect(store.clear().success).toBe(true);
  });
});
