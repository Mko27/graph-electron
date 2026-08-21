/**
 * AppContext — global state for multi-connection + multi-tab architecture.
 *
 * Architecture rules enforced here:
 *   ✅ All IPC goes through graphApi (no window.neptune / window.graphClient directly)
 *   ✅ Connection model uses ProviderConnectionDto (all 9 database types)
 *   ✅ Capabilities are stored per-connection and exposed for UI gating
 *   ✅ Dialect is carried from the connection into every query call
 *
 * State shape:
 *   connections: Record<id, ConnectionObject>
 *   queryTabs:   TabObject[]
 *   activeTabId: string
 *   notifications: Notification[]   — surfaced as toasts so no error is silent
 *   dynamo:      environment-aware DynamoDB enrichment config
 *
 * Persistence: connections (secrets encrypted by the main process), query tabs,
 * the Dynamo environment map and UI preferences are written to disk on change
 * and restored on launch. Restored connections start disconnected.
 */

import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { graphApi } from '../api/graphApi';
import {
  PROVIDER_CAPABILITIES,
  DEFAULT_PORTS,
  DYNAMO_ENVIRONMENTS,
  DEFAULT_DYNAMO_ENVIRONMENT,
} from '@graph-client/shared';
import type {
  ProviderConnectionDto,
  GraphSchemaResponse,
  UICapabilities,
  WorkspaceState,
  PersistedTab,
} from '@graph-client/shared';
import { LABEL_MODE_AUTO } from '../utils/helpers.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ConnectionObject extends ProviderConnectionDto {
  state: ConnectionState;
  statusText: string;
  schema: GraphSchemaResponse | null;
  schemaLoading: boolean;
  schemaError: string | null;
  capabilities: UICapabilities;
}

export interface TabObject {
  id: string;
  name: string;
  query: string;
  result: { data: unknown[]; duration: number; count: number } | null;
  error: string | null;
  isExecuting: boolean;
  connectionId: string | null;
  activeResultTab: 'table' | 'graph' | 'json';
  history: Array<{ query: string; success: boolean; timestamp: string }>;
}

export type NotificationType = 'error' | 'warning' | 'info' | 'success';

export interface NotificationAction {
  label: string;
  run: () => void;
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  /** Full, unabridged text — shown expanded and copyable. */
  detail?: string;
  action?: NotificationAction;
  timestamp: string;
}

export interface DynamoEnvState {
  label: string;
  region: string;
  tableName: string;
  endpoint: string;
  profile?: string;
}

export interface DynamoState {
  /** Active environment id (a key of `environments`). */
  environment: string;
  environments: Record<string, DynamoEnvState>;
  /** True once the active environment has been pushed to the main process. */
  applied: boolean;
  statusText: string;
}

interface AppContextValue {
  connections: Record<string, ConnectionObject>;
  activeConnectionId: string | null;
  setActiveConnectionId: (id: string | null) => void;
  addConnection: (dto: ProviderConnectionDto) => string;
  updateConnectionConfig: (id: string, patch: Partial<ProviderConnectionDto>) => void;
  connectConnection: (id: string) => Promise<void>;
  reconnectConnection: (id: string) => Promise<void>;
  disconnectConnection: (id: string) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
  loadSchema: (id: string) => Promise<void>;
  queryTabs: TabObject[];
  activeTabId: string;
  activeTab: TabObject | null;
  activeTabConnection: ConnectionObject | null;
  setActiveTabId: (id: string) => void;
  addTab: (connectionId?: string | null) => void;
  closeTab: (tabId: string) => void;
  renameTab: (tabId: string, name: string) => void;
  setTabQuery: (tabId: string, query: string) => void;
  setTabConnection: (tabId: string, connectionId: string | null) => void;
  setTabResultView: (tabId: string, view: 'table' | 'graph' | 'json') => void;
  executeQuery: (tabId: string) => Promise<void>;
  statusMessage: { message: string; type: 'info' | 'error' };
  setStatusMessage: (msg: { message: string; type: 'info' | 'error' }) => void;
  notifications: Notification[];
  notify: (n: Omit<Notification, 'id' | 'timestamp'>) => string;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;
  dynamo: DynamoState;
  setDynamoEnvironment: (envId: string) => Promise<void>;
  updateDynamoEnvironment: (envId: string, patch: Partial<DynamoEnvState>) => void;
  applyDynamoConfig: () => Promise<void>;
  handleFetchDynamoItem: (id: string) => Promise<{ success: boolean; data?: Record<string, unknown> | null; message?: string }>;
  graphLabelProperty: string;
  setGraphLabelProperty: (property: string) => void;
  hydrated: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const uid = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

/** Every field of ProviderConnectionDto — the whitelist written to disk. */
const CONNECTION_DTO_KEYS = [
  'id', 'name', 'dbType', 'dialect', 'host', 'port', 'ssl',
  'username', 'password', 'token', 'primaryKey', 'useIamAuth',
  'database', 'collection', 'graphName', 'space',
  'poolMin', 'poolMax', 'connectionTimeoutMs', 'queryTimeoutMs', 'maxRetries', 'retryDelayMs',
  'traversalSource', 'region', 'profile',
] as const;

/** Strip runtime-only fields (state, schema, capabilities…) before persisting. */
function toDto(conn: ConnectionObject): ProviderConnectionDto {
  const out: Record<string, unknown> = {};
  for (const key of CONNECTION_DTO_KEYS) {
    const value = (conn as unknown as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  return out as unknown as ProviderConnectionDto;
}

function makeConnection(dto: ProviderConnectionDto, overrides: Partial<ConnectionObject> = {}): ConnectionObject {
  return {
    ...dto,
    port: dto.port || DEFAULT_PORTS[dto.dbType] || 8182,
    state: 'disconnected',
    statusText: 'Disconnected',
    schema: null,
    schemaLoading: false,
    schemaError: null,
    capabilities: PROVIDER_CAPABILITIES[dto.dbType] ?? {
      supportsSchema: false,
      supportsTransactions: false,
      supportsMultiGraph: false,
      supportsStreaming: false,
    },
    ...overrides,
  };
}

function makeTab(id: string, name: string, connectionId: string | null = null): TabObject {
  return {
    id,
    name,
    query: '',
    result: null,
    error: null,
    isExecuting: false,
    connectionId,
    activeResultTab: 'table',
    history: [],
  };
}

function seedDynamoEnvironments(): Record<string, DynamoEnvState> {
  const out: Record<string, DynamoEnvState> = {};
  for (const [id, env] of Object.entries(DYNAMO_ENVIRONMENTS)) {
    out[id] = { ...env };
  }
  return out;
}

/**
 * Errors that mean "the link to the database is gone" rather than "your query
 * was wrong" — these get an offer to reconnect instead of a bare message.
 */
const CONNECTION_LOST_RE =
  /not found — call connect|not connected|websocket|socket|econnreset|econnrefused|epipe|closed|hang ?up|timed out|timeout/i;

/** How often connected connections are probed for a dropped link. */
const HEALTH_POLL_MS = 30_000;
/** Debounce before writing the workspace to disk. */
const SAVE_DEBOUNCE_MS = 500;

// ── Context ───────────────────────────────────────────────────────────────────

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [connections, setConnections] = useState<Record<string, ConnectionObject>>({});
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);

  const initialTabId = useRef(uid('tab')).current;
  const [queryTabs, setQueryTabs] = useState<TabObject[]>(() => [makeTab(initialTabId, 'Query 1')]);
  const [activeTabId, setActiveTabId] = useState<string>(initialTabId);
  const [statusMessage, setStatusMessage] = useState<{ message: string; type: 'info' | 'error' }>({
    message: 'Ready',
    type: 'info',
  });
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [dynamo, setDynamo] = useState<DynamoState>(() => ({
    environment: DEFAULT_DYNAMO_ENVIRONMENT,
    environments: seedDynamoEnvironments(),
    applied: false,
    statusText: 'Not configured',
  }));
  const [graphLabelProperty, setGraphLabelProperty] = useState<string>(LABEL_MODE_AUTO);
  const [hydrated, setHydrated] = useState(false);

  // ── Notifications ─────────────────────────────────────────────────────────

  const notify = useCallback((input: Omit<Notification, 'id' | 'timestamp'>): string => {
    const id = uid('note');
    setNotifications(prev => [
      { ...input, id, timestamp: new Date().toLocaleTimeString() },
      // Cap the stack so a failing poll cannot bury the UI.
      ...prev,
    ].slice(0, 20));
    return id;
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const clearNotifications = useCallback(() => setNotifications([]), []);

  /** Errors go to both the status bar (one line) and a toast (full text). */
  const reportError = useCallback((title: string, detail?: string, action?: NotificationAction) => {
    setStatusMessage({ message: title, type: 'error' });
    notify({ type: 'error', title, detail, action });
  }, [notify]);

  // ── State helpers ─────────────────────────────────────────────────────────

  const updateConn = useCallback((id: string, updates: Partial<ConnectionObject>) => {
    setConnections(prev => (prev[id] ? { ...prev, [id]: { ...prev[id], ...updates } } : prev));
  }, []);

  const updateTab = useCallback((tabId: string, updates: Partial<TabObject>) => {
    setQueryTabs(prev => prev.map(t => (t.id === tabId ? { ...t, ...updates } : t)));
  }, []);

  const resolveConnection = useCallback(
    (tabId: string): ConnectionObject | null => {
      const tab = queryTabs.find(t => t.id === tabId);
      if (!tab) return null;
      if (tab.connectionId && connections[tab.connectionId]) return connections[tab.connectionId];
      if (activeConnectionId && connections[activeConnectionId]) return connections[activeConnectionId];
      return Object.values(connections).find(c => c.state === 'connected') ?? null;
    },
    [queryTabs, connections, activeConnectionId],
  );

  // ── Connection actions ────────────────────────────────────────────────────

  const addConnection = useCallback((dto: ProviderConnectionDto): string => {
    const id = dto.id || uid('conn');
    const conn = makeConnection({ ...dto, id });
    setConnections(prev => ({ ...prev, [id]: conn }));
    setActiveConnectionId(id);
    return id;
  }, []);

  const updateConnectionConfig = useCallback((id: string, patch: Partial<ProviderConnectionDto>) => {
    updateConn(id, patch as Partial<ConnectionObject>);
  }, [updateConn]);

  const loadSchema = useCallback(async (connectionId: string) => {
    updateConn(connectionId, { schemaLoading: true, schemaError: null });
    try {
      const result = await graphApi.schema(connectionId);
      if (result.success) {
        updateConn(connectionId, { schema: result, schemaLoading: false });
      } else {
        const msg = result.message ?? 'Schema failed';
        updateConn(connectionId, { schemaError: msg, schemaLoading: false });
        notify({ type: 'warning', title: 'Schema introspection failed', detail: msg });
      }
    } catch (err) {
      const msg = (err as Error).message;
      updateConn(connectionId, { schemaError: msg, schemaLoading: false });
      notify({ type: 'warning', title: 'Schema introspection failed', detail: msg });
    }
  }, [updateConn, notify]);

  /**
   * Open (or re-open) a connection. The manager in the main process closes any
   * existing handle for the id first, so this doubles as the reconnect path.
   */
  const openConnection: (id: string, isRetry: boolean) => Promise<void> = useCallback(async (id: string, isRetry: boolean) => {
    const conn = connections[id];
    if (!conn) return;

    updateConn(id, {
      state: 'connecting',
      statusText: isRetry ? 'Reconnecting…' : 'Connecting…',
    });
    setStatusMessage({
      message: `${isRetry ? 'Reconnecting to' : 'Connecting to'} ${conn.name}…`,
      type: 'info',
    });

    try {
      const result = await graphApi.connect(toDto(conn));
      if (result.success) {
        updateConn(id, { state: 'connected', statusText: `Connected${result.url ? ` — ${result.url}` : ''}` });
        setStatusMessage({ message: `${isRetry ? 'Reconnected to' : 'Connected to'} ${conn.name}`, type: 'info' });
        if (isRetry) notify({ type: 'success', title: `Reconnected to ${conn.name}` });
        if (conn.capabilities.supportsSchema) loadSchema(id);
      } else {
        const msg = result.message ?? 'Connection failed';
        updateConn(id, { state: 'error', statusText: msg });
        reportError(`${conn.name}: connection failed`, msg, {
          label: 'Retry',
          run: () => { void openConnection(id, true); },
        });
      }
    } catch (err) {
      const msg = (err as Error).message;
      updateConn(id, { state: 'error', statusText: msg });
      reportError(`${conn.name}: connection failed`, msg, {
        label: 'Retry',
        run: () => { void openConnection(id, true); },
      });
    }
  }, [connections, updateConn, loadSchema, notify, reportError]);

  const connectConnection = useCallback((id: string) => openConnection(id, false), [openConnection]);
  const reconnectConnection = useCallback((id: string) => openConnection(id, true), [openConnection]);

  const disconnectConnection = useCallback(async (id: string) => {
    try {
      await graphApi.disconnect(id);
      updateConn(id, { state: 'disconnected', statusText: 'Disconnected', schema: null, schemaError: null });
      setStatusMessage({ message: 'Disconnected', type: 'info' });
    } catch (err) {
      reportError('Disconnect failed', (err as Error).message);
    }
  }, [updateConn, reportError]);

  const removeConnection = useCallback(async (id: string) => {
    await graphApi.disconnect(id).catch(() => undefined);
    setConnections(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setActiveConnectionId(prev => {
      if (prev !== id) return prev;
      const remaining = Object.keys(connections).filter(k => k !== id);
      return remaining[0] ?? null;
    });
    setQueryTabs(prev => prev.map(t => (t.connectionId === id ? { ...t, connectionId: null } : t)));
  }, [connections]);

  // ── Tab actions ───────────────────────────────────────────────────────────

  const addTab = useCallback((connectionId: string | null = null) => {
    setQueryTabs(prev => {
      const id = uid('tab');
      const newTab = makeTab(id, `Query ${prev.length + 1}`, connectionId);
      setActiveTabId(id);
      return [...prev, newTab];
    });
  }, []);

  const closeTab = useCallback((tabId: string) => {
    setQueryTabs(prev => {
      if (prev.length === 1) return prev;
      const idx = prev.findIndex(t => t.id === tabId);
      const next = prev.filter(t => t.id !== tabId);
      setActiveTabId(current => {
        if (current !== tabId) return current;
        return next[Math.min(idx, next.length - 1)].id;
      });
      return next;
    });
  }, []);

  const renameTab = useCallback((tabId: string, name: string) => updateTab(tabId, { name }), [updateTab]);
  const setTabQuery = useCallback((tabId: string, query: string) => updateTab(tabId, { query }), [updateTab]);
  const setTabConnection = useCallback((tabId: string, connectionId: string | null) => updateTab(tabId, { connectionId }), [updateTab]);
  const setTabResultView = useCallback((tabId: string, view: 'table' | 'graph' | 'json') => updateTab(tabId, { activeResultTab: view }), [updateTab]);

  // ── Query execution ───────────────────────────────────────────────────────

  const executeQuery = useCallback(async (tabId: string) => {
    const tab = queryTabs.find(t => t.id === tabId);
    if (!tab?.query.trim()) {
      setStatusMessage({ message: 'Enter a query first', type: 'error' });
      return;
    }
    if (tab.isExecuting) return;

    const conn = resolveConnection(tabId);
    if (!conn || conn.state !== 'connected') {
      reportError(
        'No active connection',
        'Connect a database before running a query. Pick one in the tab’s connection selector, or add one in the sidebar.',
        conn ? { label: `Connect ${conn.name}`, run: () => { void openConnection(conn.id, false); } } : undefined,
      );
      return;
    }

    updateTab(tabId, { isExecuting: true, error: null });
    setStatusMessage({ message: `Executing on ${conn.name}…`, type: 'info' });

    const failTab = (message: string) => {
      updateTab(tabId, {
        error: message,
        isExecuting: false,
        history: [{ query: tab.query.trim(), success: false, timestamp: new Date().toLocaleTimeString() }, ...tab.history].slice(0, 50),
      });
      const lostConnection = CONNECTION_LOST_RE.test(message);
      if (lostConnection) {
        updateConn(conn.id, { state: 'error', statusText: 'Connection lost' });
      }
      reportError(
        `Query failed on ${conn.name}`,
        message,
        lostConnection
          ? { label: 'Reconnect', run: () => { void openConnection(conn.id, true); } }
          : undefined,
      );
    };

    try {
      const result = await graphApi.query({
        id: conn.id,
        query: tab.query.trim(),
        dialect: conn.dialect,
      });

      if (result.success) {
        updateTab(tabId, {
          result: {
            data: (result.data as unknown[]) ?? [],
            duration: result.duration ?? 0,
            count: result.count ?? 0,
          },
          error: null,
          isExecuting: false,
          history: [{ query: tab.query.trim(), success: true, timestamp: new Date().toLocaleTimeString() }, ...tab.history].slice(0, 50),
        });
        setStatusMessage({
          message: `Done in ${result.duration}ms — ${result.count} result${result.count !== 1 ? 's' : ''}`,
          type: 'info',
        });
        const warnings = result.metadata?.warnings;
        if (warnings?.length) {
          notify({ type: 'warning', title: `${warnings.length} query warning(s)`, detail: warnings.join('\n') });
        }
      } else {
        failTab(result.message ?? 'Query failed');
      }
    } catch (err) {
      failTab((err as Error).message || String(err));
    }
  }, [queryTabs, resolveConnection, updateTab, updateConn, openConnection, reportError, notify]);

  // ── DynamoDB ──────────────────────────────────────────────────────────────

  const pushDynamoConfig = useCallback(async (envId: string, env: DynamoEnvState) => {
    try {
      const result = await graphApi.dynamoConfigure({
        environment: envId,
        region: env.region.trim() || 'us-east-1',
        tableName: env.tableName.trim(),
        endpoint: env.endpoint.trim(),
        profile: (env.profile ?? '').trim(),
      });

      if (result.success) {
        const text = `${env.label} — ${result.tableName} (${result.region})`;
        setDynamo(prev => ({ ...prev, applied: true, statusText: text }));
        setStatusMessage({ message: `DynamoDB: ${text}`, type: 'info' });
      } else {
        setDynamo(prev => ({ ...prev, applied: false, statusText: result.message ?? 'Config failed' }));
        reportError('DynamoDB config failed', result.message);
      }
    } catch (err) {
      const msg = (err as Error).message;
      setDynamo(prev => ({ ...prev, applied: false, statusText: msg }));
      reportError('DynamoDB config failed', msg);
    }
  }, [reportError]);

  const setDynamoEnvironment = useCallback(async (envId: string) => {
    const env = dynamo.environments[envId];
    if (!env) return;
    setDynamo(prev => ({ ...prev, environment: envId, applied: false, statusText: `Switching to ${env.label}…` }));
    await pushDynamoConfig(envId, env);
  }, [dynamo.environments, pushDynamoConfig]);

  const updateDynamoEnvironment = useCallback((envId: string, patch: Partial<DynamoEnvState>) => {
    setDynamo(prev => {
      const existing = prev.environments[envId];
      if (!existing) return prev;
      return {
        ...prev,
        // Editing the active environment invalidates what the main process holds.
        applied: envId === prev.environment ? false : prev.applied,
        environments: { ...prev.environments, [envId]: { ...existing, ...patch } },
      };
    });
  }, []);

  const applyDynamoConfig = useCallback(async () => {
    const env = dynamo.environments[dynamo.environment];
    if (!env) return;
    await pushDynamoConfig(dynamo.environment, env);
  }, [dynamo.environment, dynamo.environments, pushDynamoConfig]);

  const handleFetchDynamoItem = useCallback((id: string) => graphApi.dynamoFetchItem(id), []);

  // ── Workspace persistence ─────────────────────────────────────────────────

  // Load once on mount, before any save can run.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await graphApi.workspaceLoad();
        if (cancelled) return;

        if (!res.success) {
          notify({
            type: 'warning',
            title: 'Saved workspace could not be read',
            detail: `${res.message ?? 'Unknown error'} — starting with an empty workspace.`,
          });
        }

        const state = res.state;
        if (state) {
          if (state.connections.length > 0) {
            const restored: Record<string, ConnectionObject> = {};
            for (const dto of state.connections) {
              restored[dto.id] = makeConnection(dto, { statusText: 'Saved — not connected' });
            }
            setConnections(restored);
            setActiveConnectionId(
              state.activeConnectionId && restored[state.activeConnectionId]
                ? state.activeConnectionId
                : Object.keys(restored)[0] ?? null,
            );

            if (!res.secretsAvailable) {
              notify({
                type: 'warning',
                title: 'Saved credentials were not restored',
                detail:
                  'This machine’s OS keychain is unavailable, so passwords and tokens were not written to disk. ' +
                  'Re-enter them on the affected connections before connecting.',
              });
            }
          }

          if (state.tabs.length > 0) {
            const tabs = state.tabs.map(t => ({
              ...makeTab(t.id, t.name, t.connectionId ?? null),
              query: t.query ?? '',
              activeResultTab: t.activeResultTab ?? 'table',
              history: Array.isArray(t.history) ? t.history : [],
            }));
            setQueryTabs(tabs);
            setActiveTabId(
              state.activeTabId && tabs.some(t => t.id === state.activeTabId)
                ? state.activeTabId
                : tabs[0].id,
            );
          }

          if (state.dynamo?.environments && Object.keys(state.dynamo.environments).length > 0) {
            // Merge over the seeds so newly-shipped environments still appear.
            const merged = { ...seedDynamoEnvironments(), ...state.dynamo.environments };
            const activeEnv = merged[state.dynamo.environment] ? state.dynamo.environment : DEFAULT_DYNAMO_ENVIRONMENT;
            setDynamo(prev => ({
              ...prev,
              environment: activeEnv,
              environments: merged,
              statusText: 'Not configured',
            }));
            // Re-point the main process at the restored environment.
            void pushDynamoConfig(activeEnv, merged[activeEnv]);
          }

          if (state.ui?.graphLabelProperty) setGraphLabelProperty(state.ui.graphLabelProperty);

          setStatusMessage({
            message: `Workspace restored — ${state.connections.length} connection(s), ${state.tabs.length} tab(s)`,
            type: 'info',
          });
        }
      } catch (err) {
        if (!cancelled) {
          notify({ type: 'warning', title: 'Saved workspace could not be read', detail: (err as Error).message });
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => { cancelled = true; };
    // Runs once — pushDynamoConfig/notify are stable enough for a mount-only load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const serializeWorkspace = useCallback((): WorkspaceState => ({
    version: 1,
    connections: Object.values(connections).map(toDto),
    activeConnectionId,
    tabs: queryTabs.map<PersistedTab>(t => ({
      id: t.id,
      name: t.name,
      query: t.query,
      connectionId: t.connectionId,
      activeResultTab: t.activeResultTab,
      history: t.history,
    })),
    activeTabId,
    dynamo: { environment: dynamo.environment, environments: dynamo.environments },
    ui: { graphLabelProperty },
  }), [connections, activeConnectionId, queryTabs, activeTabId, dynamo.environment, dynamo.environments, graphLabelProperty]);

  // Debounced save. Query *results* are deliberately not persisted — only the
  // queries themselves, their history and the tab layout.
  const serializeRef = useRef(serializeWorkspace);
  serializeRef.current = serializeWorkspace;

  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      graphApi.workspaceSave(serializeRef.current()).catch(() => undefined);
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [hydrated, serializeWorkspace]);

  // Last-chance flush on window close, for edits made inside the debounce window.
  useEffect(() => {
    if (!hydrated) return;
    const flush = () => { graphApi.workspaceSave(serializeRef.current()).catch(() => undefined); };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [hydrated]);

  // ── Connection health polling ─────────────────────────────────────────────

  // A dropped websocket is otherwise invisible until the next query fails; this
  // flips the card to "Connection lost" and offers a reconnect.
  const connectedIds = useMemo(
    () => Object.values(connections).filter(c => c.state === 'connected').map(c => c.id).join(','),
    [connections],
  );

  useEffect(() => {
    if (!connectedIds) return;
    let cancelled = false;

    const poll = async () => {
      for (const id of connectedIds.split(',')) {
        if (cancelled) return;
        try {
          const health = await graphApi.health(id);
          if (cancelled || health.connected) continue;
          const detail = health.error ?? 'The database is no longer reachable.';
          updateConn(id, { state: 'error', statusText: `Connection lost — ${detail}` });
          notify({
            type: 'error',
            title: 'Connection lost',
            detail,
            action: { label: 'Reconnect', run: () => { void reconnectConnection(id); } },
          });
        } catch {
          // A failed probe alone is not proof the link is down; the next
          // query surfaces a real error with better context.
        }
      }
    };

    const timer = setInterval(poll, HEALTH_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [connectedIds, updateConn, notify, reconnectConnection]);

  // ── Derived state ─────────────────────────────────────────────────────────

  const activeTab = useMemo(
    () => queryTabs.find(t => t.id === activeTabId) ?? queryTabs[0] ?? null,
    [queryTabs, activeTabId],
  );

  const activeTabConnection = useMemo(
    () => (activeTab ? resolveConnection(activeTab.id) : null),
    [activeTab, resolveConnection],
  );

  const value: AppContextValue = {
    connections,
    activeConnectionId,
    setActiveConnectionId,
    addConnection,
    updateConnectionConfig,
    connectConnection,
    reconnectConnection,
    disconnectConnection,
    removeConnection,
    loadSchema,
    queryTabs,
    activeTabId,
    activeTab,
    activeTabConnection,
    setActiveTabId,
    addTab,
    closeTab,
    renameTab,
    setTabQuery,
    setTabConnection,
    setTabResultView,
    executeQuery,
    statusMessage,
    setStatusMessage,
    notifications,
    notify,
    dismissNotification,
    clearNotifications,
    dynamo,
    setDynamoEnvironment,
    updateDynamoEnvironment,
    applyDynamoConfig,
    handleFetchDynamoItem,
    graphLabelProperty,
    setGraphLabelProperty,
    hydrated,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
