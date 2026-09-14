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
import type { WorkspaceState, ProviderConnectionDto } from '@graph-client/shared';

const log = vi.fn();

let dir: string;
let file: string;

function makeStore() {
  return new WorkspaceStore(log as never, file);
}

function makeConnection(overrides: Partial<ProviderConnectionDto> = {}): ProviderConnectionDto {
  return {
    id: 'conn_1',
    name: 'Stage',
    dbType: 'neo4j',
    dialect: 'cypher',
    host: 'db.example.com',
    port: 7687,
    ssl: true,
    username: 'neo4j',
    password: 's3cret',
    ...overrides,
  } as ProviderConnectionDto;
}

function makeState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    version: 2,
    connections: [makeConnection()],
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

function readRaw(): { version: number; state: WorkspaceState; secrets?: string } {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-store-'));
  file = path.join(dir, 'workspace.json');
  encryptionAvailable.value = true;
  log.mockClear();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('WorkspaceStore.load — no saved state', () => {
  it('reports success with no state when the file is missing', () => {
    const res = makeStore().load();
    expect(res.success).toBe(true);
    expect(res.state).toBeUndefined();
    expect(res.connectionsWithSecrets).toEqual([]);
  });
});

describe('WorkspaceStore round-trip', () => {
  it('restores connections, tabs and settings', async () => {
    const store = makeStore();
    await store.save(makeState());

    const res = makeStore().load();
    expect(res.success).toBe(true);
    expect(res.state?.connections).toHaveLength(1);
    expect(res.state?.connections[0].host).toBe('db.example.com');
    expect(res.state?.tabs[0].query).toBe('MATCH (n) RETURN n');
    expect(res.state?.activeTabId).toBe('tab_1');
  });

  it('writes the file atomically, leaving no .tmp behind', async () => {
    await makeStore().save(makeState());
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it('serialises concurrent saves without corrupting the file', async () => {
    const store = makeStore();
    await Promise.all([
      store.save(makeState({ activeTabId: 'a' })),
      store.save(makeState({ activeTabId: 'b' })),
      store.save(makeState({ activeTabId: 'c' })),
    ]);
    // Whichever landed last, the file must still be valid JSON.
    expect(() => readRaw()).not.toThrow();
  });
});

describe('WorkspaceStore secrets never reach the renderer', () => {
  it('keeps passwords out of the plaintext state on disk', async () => {
    await makeStore().save(makeState());

    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).not.toContain('s3cret');
    expect(readRaw().state.connections[0]).not.toHaveProperty('password');
    expect(readRaw().secrets).toBeTruthy();
  });

  it('does not return secrets from load — only which connections have them', async () => {
    await makeStore().save(makeState());

    const res = makeStore().load();
    expect(res.connectionsWithSecrets).toEqual(['conn_1']);
    expect(JSON.stringify(res.state)).not.toContain('s3cret');
    expect(res.state?.connections[0]).not.toHaveProperty('password');
  });

  it('fills a stored secret back in on the way to the driver', async () => {
    await makeStore().save(makeState());

    const store = makeStore();
    store.load();
    // The renderer sends the config with no password, as it now does.
    const merged = store.applySecrets(makeConnection({ password: undefined }));
    expect(merged.password).toBe('s3cret');
  });

  it('prefers a freshly supplied secret over the stored one', async () => {
    await makeStore().save(makeState());
    const store = makeStore();
    store.load();
    expect(store.applySecrets(makeConnection({ password: 'typed-now' })).password).toBe('typed-now');
  });

  it('remembers a secret from a connect request', async () => {
    const store = makeStore();
    store.rememberSecrets(makeConnection({ id: 'conn_9', password: 'from-connect' }));
    await store.save(makeState({ connections: [makeConnection({ id: 'conn_9', password: undefined })] }));

    const reloaded = makeStore();
    reloaded.load();
    expect(reloaded.applySecrets(makeConnection({ id: 'conn_9', password: undefined })).password)
      .toBe('from-connect');
  });

  it('does not erase a stored secret when the renderer saves without it', async () => {
    const store = makeStore();
    await store.save(makeState());

    // A later save from the renderer, which no longer holds the password.
    await store.save(makeState({ connections: [makeConnection({ password: undefined })] }));

    const reloaded = makeStore();
    reloaded.load();
    expect(reloaded.applySecrets(makeConnection({ password: undefined })).password).toBe('s3cret');
  });

  it('forgets secrets for a removed connection', async () => {
    const store = makeStore();
    await store.save(makeState());
    store.forgetSecrets('conn_1');
    await store.save(makeState({ connections: [] }));

    const reloaded = makeStore();
    const res = reloaded.load();
    expect(res.connectionsWithSecrets).toEqual([]);
  });

  it('drops secrets rather than writing them in the clear when encryption is unavailable', async () => {
    encryptionAvailable.value = false;
    await makeStore().save(makeState());

    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).not.toContain('s3cret');
    expect(readRaw().secrets).toBeUndefined();

    const res = makeStore().load();
    expect(res.secretsAvailable).toBe(false);
    expect(res.connectionsWithSecrets).toEqual([]);
  });
});

describe('WorkspaceStore version handling', () => {
  it('migrates a format-1 file forward instead of discarding it', async () => {
    await makeStore().save(makeState());
    // Rewrite the file as the older format.
    const raw = readRaw();
    fs.writeFileSync(file, JSON.stringify({ ...raw, version: 1 }, null, 2));

    const res = makeStore().load();
    expect(res.success).toBe(true);
    expect(res.state?.connections).toHaveLength(1);
    expect(res.state?.tabs).toHaveLength(1);
  });

  it('preserves a newer file and reports it instead of wiping it', async () => {
    await makeStore().save(makeState());
    const raw = readRaw();
    fs.writeFileSync(file, JSON.stringify({ ...raw, version: 999 }, null, 2));

    const res = makeStore().load();
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/newer version/i);
    expect(res.state).toBeUndefined();

    // The original file is untouched, so a downgrade cannot destroy it.
    expect(readRaw().version).toBe(999);
    // And a recovery copy exists.
    expect(fs.readdirSync(dir).some((f) => f.endsWith('.bak'))).toBe(true);
  });

  it('backs up and reports an unreadable file rather than silently starting fresh', () => {
    fs.writeFileSync(file, '{ this is not json');

    const res = makeStore().load();
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/could not be read/i);
    expect(fs.readdirSync(dir).some((f) => f.endsWith('.bak'))).toBe(true);
  });
});

describe('WorkspaceStore.clear', () => {
  it('removes the saved file', async () => {
    await makeStore().save(makeState());
    const store = makeStore();
    expect(store.clear().success).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe('WorkspaceStore hand-edited files', () => {
  it('drops malformed connections and tabs instead of throwing', async () => {
    await makeStore().save(makeState());
    const raw = readRaw();
    raw.state.connections = [null, { name: 'no id' }, makeConnection()] as never;
    raw.state.tabs = [null, { name: 'no id' }] as never;
    fs.writeFileSync(file, JSON.stringify(raw, null, 2));

    const res = makeStore().load();
    expect(res.success).toBe(true);
    expect(res.state?.connections).toHaveLength(1);
    expect(res.state?.tabs).toHaveLength(0);
  });
});
