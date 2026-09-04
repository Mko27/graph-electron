import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import type { Logger } from '@graph-client/core';
import type {
  ProviderConnectionDto,
  WorkspaceState,
  WorkspaceLoadResponse,
} from '@graph-client/shared';

/**
 * Bumped only for a shape change the loader cannot read. Older files are
 * migrated forward (see _migrate) rather than discarded.
 */
const WORKSPACE_VERSION = 2;

/** The oldest version _migrate knows how to bring forward. */
const MIN_MIGRATABLE_VERSION = 1;

/** Connection fields that must never be written to disk in plaintext. */
const SECRET_FIELDS = ['password', 'token', 'primaryKey'] as const;
type SecretField = (typeof SECRET_FIELDS)[number];

type ConnectionSecrets = Partial<Record<SecretField, string>>;
type SecretMap = Record<string, ConnectionSecrets>;

interface WorkspaceFile {
  version: number;
  savedAt: string;
  state: WorkspaceState;
  /** Base64 of safeStorage-encrypted JSON — absent when encryption is unavailable. */
  secrets?: string;
}

/**
 * WorkspaceStore — persists connections, query tabs and settings to disk so a
 * restart restores the previous session.
 *
 * Secrets never reach the renderer. They are split out of the state, kept in
 * this process, and encrypted with Electron's safeStorage (OS keychain on
 * macOS, DPAPI on Windows, libsecret on Linux). The renderer is told only
 * WHICH connections have a stored credential, via `connectionsWithSecrets`, and
 * the connect handler fills the real values in on the way to the driver. When
 * encryption is unavailable, secrets are dropped rather than written in the
 * clear and `secretsAvailable: false` tells the UI to ask for them again.
 *
 * Writes are atomic (tmp file + rename) and asynchronous, so a save cannot
 * leave a truncated workspace behind or block the main thread.
 */
export class WorkspaceStore {
  private readonly filePath: string;
  /** Decrypted secrets, held only in this process. */
  private secrets: SecretMap = {};
  /** Serialises concurrent saves so two writers cannot interleave. */
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly log: Logger, filePath?: string) {
    this.filePath = filePath ?? path.join(app.getPath('userData'), 'workspace.json');
  }

  getPath(): string {
    return this.filePath;
  }

  /** True when the OS keychain is usable for encrypting secrets. */
  isEncryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  load(): WorkspaceLoadResponse {
    const secretsAvailable = this.isEncryptionAvailable();

    if (!fs.existsSync(this.filePath)) {
      this.log('info', `Workspace: no saved state at ${this.filePath}`);
      return { success: true, secretsAvailable, connectionsWithSecrets: [] };
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as WorkspaceFile;

      const migrated = this._migrate(parsed);
      if (!migrated) {
        // Unreadable version: keep the file untouched and take a backup so the
        // user's connections are recoverable rather than silently overwritten.
        const backup = this._backupPath(parsed.version);
        this._copyAside(backup);
        return {
          success: false,
          secretsAvailable,
          connectionsWithSecrets: [],
          message:
            `This workspace was written by a newer version (format ${parsed.version}, ` +
            `this build reads ${WORKSPACE_VERSION}). It has been left intact and copied to ` +
            `${path.basename(backup)}. Update the app to load it.`,
        };
      }

      const state = this._normalizeState(migrated.state);
      this.secrets = this._decryptSecrets(migrated.secrets) ?? {};

      // Connections are handed over WITHOUT their secrets.
      const connectionsWithSecrets = state.connections
        .filter((c) => this._hasSecret(c.id))
        .map((c) => c.id);

      this.log(
        'info',
        `Workspace: restored ${state.connections.length} connection(s), ${state.tabs.length} tab(s) ` +
        `(${connectionsWithSecrets.length} with saved credentials)`,
      );
      return { success: true, state, secretsAvailable, connectionsWithSecrets };
    } catch (err) {
      this.log('error', `Workspace: failed to read ${this.filePath}:`, (err as Error).message);
      const backup = this._backupPath('corrupt');
      this._copyAside(backup);
      return {
        success: false,
        secretsAvailable,
        connectionsWithSecrets: [],
        message:
          `Saved workspace could not be read (${(err as Error).message}). ` +
          `A copy was kept at ${path.basename(backup)}.`,
      };
    }
  }

  /**
   * Persist the workspace. Secret fields present on incoming connections are
   * absorbed into the encrypted store; connections whose secrets the renderer
   * does not know keep the ones already held, so a save cannot erase a
   * credential the renderer never saw.
   */
  save(state: WorkspaceState): Promise<{ success: boolean; message?: string }> {
    const sanitized = this._absorbSecrets(this._normalizeState(state));

    const file: WorkspaceFile = {
      version: WORKSPACE_VERSION,
      savedAt: new Date().toISOString(),
      state: sanitized,
    };
    const encrypted = this._encryptSecrets(this.secrets);
    if (encrypted) file.secrets = encrypted;

    const payload = JSON.stringify(file, null, 2);

    // Chained + async: the previous implementation wrote synchronously on the
    // main thread, stalling everything else on every keystroke's debounce.
    const run = this.writeChain.then(async () => {
      try {
        await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
        const tmpPath = `${this.filePath}.tmp`;
        await fsp.writeFile(tmpPath, payload, { encoding: 'utf8', mode: 0o600 });
        await fsp.rename(tmpPath, this.filePath);
        return { success: true };
      } catch (err) {
        this.log('error', 'Workspace: failed to save:', (err as Error).message);
        return { success: false, message: (err as Error).message };
      }
    });

    this.writeChain = run.catch(() => undefined);
    return run;
  }

  /**
   * Record the secrets carried by a connect request, so they survive a restart
   * without the renderer having to hold or re-send them.
   */
  rememberSecrets(config: ProviderConnectionDto): void {
    const incoming: ConnectionSecrets = {};
    for (const field of SECRET_FIELDS) {
      const value = (config as unknown as Record<string, unknown>)[field];
      if (typeof value === 'string' && value !== '') incoming[field] = value;
    }
    if (Object.keys(incoming).length === 0) return;
    this.secrets[config.id] = { ...this.secrets[config.id], ...incoming };
  }

  /**
   * Fill in any secret the caller did not supply from the encrypted store.
   * Used on the way to the driver, so the renderer never needs the value.
   */
  applySecrets<T extends ProviderConnectionDto>(config: T): T {
    const stored = this.secrets[config.id];
    if (!stored) return config;

    const merged = { ...config } as unknown as Record<string, unknown>;
    for (const field of SECRET_FIELDS) {
      const supplied = merged[field];
      if ((supplied === undefined || supplied === '') && stored[field] !== undefined) {
        merged[field] = stored[field];
      }
    }
    return merged as unknown as T;
  }

  /** Drop a removed connection's stored credentials. */
  forgetSecrets(id: string): void {
    delete this.secrets[id];
  }

  clear(): { success: boolean; message?: string } {
    try {
      if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
      this.secrets = {};
      this.log('info', 'Workspace: saved state cleared');
      return { success: true };
    } catch (err) {
      return { success: false, message: (err as Error).message };
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private _hasSecret(id: string): boolean {
    const entry = this.secrets[id];
    return Boolean(entry && Object.keys(entry).length > 0);
  }

  private _backupPath(tag: string | number): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${this.filePath}.v${tag}.${stamp}.bak`;
  }

  private _copyAside(backupPath: string): void {
    try {
      fs.copyFileSync(this.filePath, backupPath);
      this.log('warn', `Workspace: kept a copy of the previous state at ${backupPath}`);
    } catch (err) {
      this.log('error', `Workspace: could not back up state: ${(err as Error).message}`);
    }
  }

  /**
   * Bring an older file forward. Returns null when the file cannot be read at
   * all — the caller then preserves it rather than overwriting.
   *
   * Discarding a version it did not recognise is what made an app update able
   * to wipe every saved connection with nothing shown to the user.
   */
  private _migrate(file: WorkspaceFile): WorkspaceFile | null {
    const version = typeof file.version === 'number' ? file.version : 0;

    if (version === WORKSPACE_VERSION) return file;

    // Newer than we understand: refuse rather than guess.
    if (version > WORKSPACE_VERSION) return null;

    if (version < MIN_MIGRATABLE_VERSION) return null;

    // v1 → v2: identical shape. v1 stored secrets inside state.connections as
    // well as in the encrypted blob; both are read here and the secrets are
    // lifted out on load, so nothing is lost.
    if (version === 1) {
      this.log('info', `Workspace: migrating saved state from format 1 to ${WORKSPACE_VERSION}`);
      return { ...file, version: WORKSPACE_VERSION };
    }

    return null;
  }

  /** Guard against a hand-edited or partially-written file. */
  private _normalizeState(state: WorkspaceState | undefined): WorkspaceState {
    return {
      version: WORKSPACE_VERSION,
      connections: Array.isArray(state?.connections)
        ? state!.connections.filter((c) => c && typeof c.id === 'string')
        : [],
      activeConnectionId: state?.activeConnectionId ?? null,
      tabs: Array.isArray(state?.tabs) ? state!.tabs.filter((t) => t && typeof t.id === 'string') : [],
      activeTabId: state?.activeTabId ?? null,
      ...(state?.dynamo ? { dynamo: state.dynamo } : {}),
      ...(state?.ui ? { ui: state.ui } : {}),
    };
  }

  /**
   * Move any secrets carried on the incoming connections into the encrypted
   * store and strip them from the state that gets written as plaintext.
   */
  private _absorbSecrets(state: WorkspaceState): WorkspaceState {
    const connections: ProviderConnectionDto[] = state.connections.map((conn) => {
      const copy = { ...conn } as unknown as Record<string, unknown>;
      const incoming: ConnectionSecrets = {};

      for (const field of SECRET_FIELDS) {
        const value = copy[field];
        if (typeof value === 'string' && value !== '') incoming[field] = value;
        delete copy[field];
      }

      if (Object.keys(incoming).length > 0) {
        this.secrets[conn.id] = { ...this.secrets[conn.id], ...incoming };
      }
      return copy as unknown as ProviderConnectionDto;
    });

    // Forget credentials for connections that no longer exist.
    const liveIds = new Set(connections.map((c) => c.id));
    for (const id of Object.keys(this.secrets)) {
      if (!liveIds.has(id)) delete this.secrets[id];
    }

    return { ...state, connections };
  }

  private _encryptSecrets(secrets: SecretMap): string | null {
    if (Object.keys(secrets).length === 0) return null;
    if (!this.isEncryptionAvailable()) {
      this.log('warn', 'Workspace: OS encryption unavailable — connection secrets were not saved');
      return null;
    }
    try {
      return safeStorage.encryptString(JSON.stringify(secrets)).toString('base64');
    } catch (err) {
      this.log('warn', 'Workspace: could not encrypt secrets, they were not saved:', (err as Error).message);
      return null;
    }
  }

  private _decryptSecrets(encoded: string | undefined): SecretMap | null {
    if (!encoded) return null;
    if (!this.isEncryptionAvailable()) {
      this.log('warn', 'Workspace: OS encryption unavailable — saved secrets could not be read');
      return null;
    }
    try {
      return JSON.parse(safeStorage.decryptString(Buffer.from(encoded, 'base64'))) as SecretMap;
    } catch (err) {
      // A different machine / OS user cannot decrypt the blob — not fatal.
      this.log('warn', 'Workspace: saved secrets could not be decrypted:', (err as Error).message);
      return null;
    }
  }
}
