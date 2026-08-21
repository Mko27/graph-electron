import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { Logger } from '@graph-client/core';
import type {
  ProviderConnectionDto,
  WorkspaceState,
  WorkspaceLoadResponse,
} from '@graph-client/shared';

/** Bump when the on-disk shape changes incompatibly. */
const WORKSPACE_VERSION = 1;

/** Connection fields that must never be written to disk in plaintext. */
const SECRET_FIELDS = ['password', 'token', 'primaryKey'] as const;
type SecretField = (typeof SECRET_FIELDS)[number];

type SecretMap = Record<string, Partial<Record<SecretField, string>>>;

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
 * Secrets (password / token / primaryKey) are split out of the plaintext state
 * and encrypted with Electron's safeStorage, which is backed by the OS keychain
 * (Keychain on macOS, DPAPI on Windows, libsecret on Linux). When encryption is
 * unavailable the secrets are dropped rather than written in the clear, and
 * `secretsAvailable: false` tells the UI that credentials must be re-entered.
 *
 * Writes are atomic (tmp file + rename) so an interrupted save cannot leave a
 * truncated workspace behind.
 */
export class WorkspaceStore {
  private readonly filePath: string;

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
      return { success: true, secretsAvailable };
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as WorkspaceFile;

      if (parsed.version !== WORKSPACE_VERSION) {
        this.log('warn', `Workspace: ignoring state with version ${parsed.version} (expected ${WORKSPACE_VERSION})`);
        return { success: true, secretsAvailable };
      }

      const state = this._normalizeState(parsed.state);
      const secrets = this._decryptSecrets(parsed.secrets);
      if (secrets) {
        for (const conn of state.connections) {
          const forConn = secrets[conn.id];
          if (!forConn) continue;
          for (const field of SECRET_FIELDS) {
            if (forConn[field] != null) (conn as unknown as Record<string, unknown>)[field] = forConn[field];
          }
        }
      }

      this.log(
        'info',
        `Workspace: restored ${state.connections.length} connection(s), ${state.tabs.length} tab(s) from ${this.filePath}`,
      );
      return { success: true, state, secretsAvailable };
    } catch (err) {
      this.log('error', `Workspace: failed to read ${this.filePath}:`, (err as Error).message);
      return { success: false, secretsAvailable, message: (err as Error).message };
    }
  }

  save(state: WorkspaceState): { success: boolean; message?: string } {
    try {
      const { sanitized, secrets } = this._splitSecrets(this._normalizeState(state));

      const file: WorkspaceFile = {
        version: WORKSPACE_VERSION,
        savedAt: new Date().toISOString(),
        state: sanitized,
      };

      const encrypted = this._encryptSecrets(secrets);
      if (encrypted) file.secrets = encrypted;

      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmpPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(file, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmpPath, this.filePath);

      return { success: true };
    } catch (err) {
      this.log('error', 'Workspace: failed to save:', (err as Error).message);
      return { success: false, message: (err as Error).message };
    }
  }

  clear(): { success: boolean; message?: string } {
    try {
      if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
      this.log('info', 'Workspace: saved state cleared');
      return { success: true };
    } catch (err) {
      return { success: false, message: (err as Error).message };
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /** Guard against a hand-edited or partially-written file. */
  private _normalizeState(state: WorkspaceState | undefined): WorkspaceState {
    return {
      version: WORKSPACE_VERSION,
      connections: Array.isArray(state?.connections) ? state!.connections.filter(c => c && typeof c.id === 'string') : [],
      activeConnectionId: state?.activeConnectionId ?? null,
      tabs: Array.isArray(state?.tabs) ? state!.tabs.filter(t => t && typeof t.id === 'string') : [],
      activeTabId: state?.activeTabId ?? null,
      ...(state?.dynamo ? { dynamo: state.dynamo } : {}),
      ...(state?.ui ? { ui: state.ui } : {}),
    };
  }

  private _splitSecrets(state: WorkspaceState): { sanitized: WorkspaceState; secrets: SecretMap } {
    const secrets: SecretMap = {};
    const connections: ProviderConnectionDto[] = state.connections.map(conn => {
      const copy = { ...conn } as unknown as Record<string, unknown>;
      for (const field of SECRET_FIELDS) {
        const value = copy[field];
        if (typeof value === 'string' && value !== '') {
          secrets[conn.id] = { ...secrets[conn.id], [field]: value };
        }
        delete copy[field];
      }
      return copy as unknown as ProviderConnectionDto;
    });

    return { sanitized: { ...state, connections }, secrets };
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
