/**
 * AppContext — global state for the environment + multi-tab architecture.
 *
 * An **environment** pairs one graph endpoint (Neptune by default) with one
 * DynamoDB source. A query tab points at an environment rather than at a bare
 * connection, so the graph being queried and the table enrichment reads from
 * cannot drift apart — the old failure mode where the tab said "Plive" while
 * DynamoDB was still serving `stage_blocks`.
 *
 * Architecture rules enforced here:
 *   ✅ All IPC goes through graphApi (no window.neptune / window.graphClient directly)
 *   ✅ Each environment's endpoint is a ProviderConnectionDto (all 9 database types)
 *   ✅ Capabilities are stored per-connection and exposed for UI gating
 *   ✅ Dialect is carried from the connection into every query call
 *
 * State shape:
 *   environments:  EnvironmentObject[]          — ordered, user-editable
 *   connections:   Record<id, ConnectionObject> — the endpoint each environment owns
 *   queryTabs:     TabObject[]                  — each carries an environmentId
 *   notifications: Notification[]               — surfaced as toasts so no error is silent
 *   dynamoRuntime: which environment's DynamoDB config the main process holds
 *
 * The live DynamoDB config follows the **active tab's** environment: switching
 * tabs re-points enrichment. Editing a config still needs an explicit Apply, so
 * a half-typed table name is never pushed.
 *
 * Persistence: environments, connections (secrets encrypted by the main
 * process), query tabs and UI preferences are written to disk on change and
 * restored on launch. Restored environments start disconnected.
 */

import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { graphApi } from '../api/graphApi';
import {
  PROVIDER_CAPABILITIES,
  DEFAULT_PORTS,
  DYNAMO_ENVIRONMENTS,
  DYNAMO_ENVIRONMENT_ORDER,
} from '@graph-client/shared';
import type {
  ProviderConnectionDto,
  GraphSchemaResponse,
  UICapabilities,
  WorkspaceState,
  PersistedTab,
  PersistedEnvironment,
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
  /**
   * True when the main process holds a saved credential for this connection.
   *
   * The credential itself is never sent here: it is written to the OS keychain
   * by the main process and filled in on the way to the driver. This flag only
   * tells the UI it can connect without prompting.
   */
  hasStoredSecret: boolean;
}

/** DynamoDB source of one environment. */
export interface DynamoConfig {
  region: string;
  tableName: string;
  endpoint: string;
  profile?: string;
}

export interface EnvironmentObject {
  id: string;
  label: string;
  /** Endpoint this environment owns — a key of `connections`, or null if unset. */
  connectionId: string | null;
  dynamo: DynamoConfig;
}

/** What the main process currently holds for DynamoDB lookups. */
export interface DynamoRuntime {
  /** Environment the held config came from. */
  envId: string | null;
  applied: boolean;
  statusText: string;
}

export interface TabObject {
  id: string;
  name: string;
  query: string;
  result: { data: unknown[]; duration: number; count: number } | null;
  error: string | null;
  isExecuting: boolean;
  environmentId: string | null;
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

interface AppContextValue {
  // ── Environments ──
  environments: EnvironmentObject[];
  /** Environments with an endpoint set — the only ones a tab can be pointed at. */
  configuredEnvironments: EnvironmentObject[];
  /** Environment open in the sidebar editor. */
  selectedEnvironmentId: string | null;
  setSelectedEnvironmentId: (id: string) => void;
  addEnvironment: () => void;
  removeEnvironment: (id: string) => Promise<void>;
  renameEnvironment: (id: string, label: string) => void;
  /** Patch the environment's endpoint, minting the connection on first edit. */
  updateEnvironmentGraph: (id: string, patch: Partial<ProviderConnectionDto>) => void;
  updateEnvironmentDynamo: (id: string, patch: Partial<DynamoConfig>) => void;
  applyEnvironmentDynamo: (id: string) => Promise<void>;
  connectEnvironment: (id: string) => Promise<void>;
  reconnectEnvironment: (id: string) => Promise<void>;
  disconnectEnvironment: (id: string) => Promise<void>;
  /** The endpoint of an environment, or null while it has none. */
  envConnection: (env: EnvironmentObject | null | undefined) => ConnectionObject | null;
  isEnvironmentConfigured: (env: EnvironmentObject | null | undefined) => boolean;
  connections: Record<string, ConnectionObject>;
  loadSchema: (connectionId: string) => Promise<void>;
  reconnectConnection: (connectionId: string) => Promise<void>;

  // ── Tabs ──
  queryTabs: TabObject[];
  activeTabId: string;
  activeTab: TabObject | null;
  activeTabEnvironment: EnvironmentObject | null;
  activeTabConnection: ConnectionObject | null;
  setActiveTabId: (id: string) => void;
  addTab: (environmentId?: string | null) => void;
  closeTab: (tabId: string) => void;
  renameTab: (tabId: string, name: string) => void;
  setTabQuery: (tabId: string, query: string) => void;
  /** Point a tab at an environment; connects it and re-points DynamoDB. */
  setTabEnvironment: (tabId: string, environmentId: string | null) => Promise<void>;
  setTabResultView: (tabId: string, view: 'table' | 'graph' | 'json') => void;
  executeQuery: (tabId: string) => Promise<void>;
  cancelQuery: (tabId: string) => void;

  // ── Misc ──
  statusMessage: { message: string; type: 'info' | 'error' };
  setStatusMessage: (msg: { message: string; type: 'info' | 'error' }) => void;
  notifications: Notification[];
  notify: (n: Omit<Notification, 'id' | 'timestamp'>) => string;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;
  dynamoRuntime: DynamoRuntime;
  handleFetchDynamoItem: (id: string) => Promise<{ success: boolean; data?: Record<string, unknown> | null; message?: string }>;
  /**
   * Properties for vertices that came back as bare references, keyed by id.
   * Ids that could not be read are simply absent from the result.
   */
  hydrateVertexProperties: (ids: string[]) => Promise<Record<string, Record<string, unknown>>>;
  /**
   * The same for edges, whose properties `path()` omits just as it does
   * vertices'. Keyed by `outV|inV|type` as well as by the id the server
   * reports — Neptune hands out a different edge id in a path than
   * `elementMap()` returns for the same edge, so the id alone cannot match.
   */
  hydrateEdgeProperties: (ids: string[]) => Promise<Record<string, Record<string, unknown>>>;
  graphLabelProperty: string;
  setGraphLabelProperty: (property: string) => void;
  /**
   * What each vertex type shows inside its node, keyed by vertex label. Shared
   * by every tab and persisted, so the choice is made once per project.
   */
  graphLabelModes: Record<string, string>;
  setGraphLabelMode: (vertexLabel: string, mode: string) => void;
  /** What each edge type draws on its line, keyed by edge type. */
  graphEdgeLabelModes: Record<string, string>;
  setGraphEdgeLabelMode: (edgeLabel: string, mode: string) => void;
  /** Clears both maps — vertices and edges go back to Auto. */
  resetGraphLabelModes: () => void;
  /**
   * Which collapsible sidebar sections are open, keyed by section id. Ids the
   * user has never toggled are absent, so each section keeps its own default.
   */
  sidebarSections: Record<string, boolean>;
  setSidebarSection: (id: string, open: boolean) => void;
  /** Height the query editor was dragged to, or null for the default. */
  queryPanelHeight: number | null;
  setQueryPanelHeight: (height: number | null) => void;
  hydrated: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const uid = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

/**
 * Non-secret fields of ProviderConnectionDto. Credentials are deliberately
 * absent: they go to the main process once, on connect, and are never held in
 * renderer state or written back out of it.
 */
const CONNECTION_DTO_KEYS = [
  'id', 'name', 'dbType', 'dialect', 'host', 'port', 'ssl',
  'username', 'useIamAuth',
  'database', 'collection', 'graphName', 'space',
  'poolMin', 'poolMax', 'connectionTimeoutMs', 'queryTimeoutMs', 'maxRetries', 'retryDelayMs',
  'traversalSource', 'region', 'profile',
] as const;

/** Credential fields, kept out of both renderer state and the saved workspace. */
const SECRET_KEYS = ['password', 'token', 'primaryKey'] as const;

/** Strip runtime-only fields AND credentials before persisting or re-sending. */
function toDto(conn: ConnectionObject): ProviderConnectionDto {
  const out: Record<string, unknown> = {};
  for (const key of CONNECTION_DTO_KEYS) {
    const value = (conn as unknown as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  return out as unknown as ProviderConnectionDto;
}

/** True when the config carries at least one credential. */
function carriesSecret(dto: ProviderConnectionDto): boolean {
  return SECRET_KEYS.some((key) => {
    const value = (dto as unknown as Record<string, unknown>)[key];
    return typeof value === 'string' && value !== '';
  });
}

/** Pull just the credential fields off a connection object. */
function pickSecrets(conn: ConnectionObject): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SECRET_KEYS) {
    const value = (conn as unknown as Record<string, unknown>)[key];
    if (typeof value === 'string' && value !== '') out[key] = value;
  }
  return out;
}

/** Partial update that blanks every credential field. */
function clearedSecrets(): Partial<ConnectionObject> {
  const out: Record<string, undefined> = {};
  for (const key of SECRET_KEYS) out[key] = undefined;
  return out as Partial<ConnectionObject>;
}

function capabilitiesFor(dbType: string): UICapabilities {
  return PROVIDER_CAPABILITIES[dbType] ?? {
    supportsSchema: false,
    supportsTransactions: false,
    supportsMultiGraph: false,
    supportsStreaming: false,
  };
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
    capabilities: capabilitiesFor(dto.dbType),
    hasStoredSecret: false,
    ...overrides,
  } as ConnectionObject;
}

function makeTab(id: string, name: string, environmentId: string | null = null): TabObject {
  return {
    id,
    name,
    query: '',
    result: null,
    error: null,
    isExecuting: false,
    environmentId,
    activeResultTab: 'table',
    history: [],
  };
}

/** A fresh environment's endpoint: Neptune over IAM, host still to be filled in. */
function makeEnvConnectionDto(id: string, name: string): ProviderConnectionDto {
  return {
    id,
    name,
    dbType: 'neptune',
    dialect: 'gremlin',
    host: '',
    port: DEFAULT_PORTS['neptune'] ?? 8182,
    ssl: true,
    useIamAuth: true,
  };
}

const DEFAULT_DYNAMO: DynamoConfig = { region: 'us-east-1', tableName: '', endpoint: '' };

/** Local / Stage / Plive, seeded from the shipped DynamoDB defaults. */
function seedEnvironments(): EnvironmentObject[] {
  return DYNAMO_ENVIRONMENT_ORDER
    .filter(id => DYNAMO_ENVIRONMENTS[id])
    .map(id => {
      const env = DYNAMO_ENVIRONMENTS[id];
      return {
        id,
        label: env.label,
        connectionId: null,
        dynamo: { region: env.region, tableName: env.tableName, endpoint: env.endpoint },
      };
    });
}

/**
 * Errors that mean "the link to the database is gone" rather than "your query
 * was wrong" — these get an offer to reconnect instead of a bare message.
 *
 * Timeouts and the bare word "closed" are deliberately NOT here: a slow query
 * on a perfectly healthy connection was being reported as a dropped link, and
 * the connection card turned red offering a pointless reconnect.
 */
const CONNECTION_LOST_RE = new RegExp(
  [
    'not found — call connect',
    'not connected',
    'connection (?:is )?(?:closed|lost|terminated)',
    'websocket (?:is )?(?:closed|not open)',
    'socket hang ?up',
    'econnreset',
    'econnrefused',
    'enotfound',
    'ehostunreach',
    'epipe',
    'server closed the connection',
  ].join('|'),
  'i',
);

/** How often connected endpoints are probed for a dropped link. */
const HEALTH_POLL_MS = 30_000;
/** Vertex ids per hydration query, and the ceiling across one result set. */
const HYDRATE_CHUNK = 200;
const MAX_HYDRATE_IDS = 2000;
/** Debounce before writing the workspace to disk. */
const SAVE_DEBOUNCE_MS = 500;

// ── Context ───────────────────────────────────────────────────────────────────

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [connections, setConnections] = useState<Record<string, ConnectionObject>>({});
  const [environments, setEnvironments] = useState<EnvironmentObject[]>(() => seedEnvironments());
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | null>(
    () => seedEnvironments()[0]?.id ?? null,
  );

  const initialTabId = useRef(uid('tab')).current;
  const [queryTabs, setQueryTabs] = useState<TabObject[]>(() => [makeTab(initialTabId, 'Query 1')]);
  const [activeTabId, setActiveTabId] = useState<string>(initialTabId);
  const [statusMessage, setStatusMessage] = useState<{ message: string; type: 'info' | 'error' }>({
    message: 'Ready',
    type: 'info',
  });
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [dynamoRuntime, setDynamoRuntime] = useState<DynamoRuntime>({
    envId: null,
    applied: false,
    statusText: 'Not configured',
  });
  const [graphLabelProperty, setGraphLabelProperty] = useState<string>(LABEL_MODE_AUTO);
  const [graphLabelModes, setGraphLabelModes] = useState<Record<string, string>>({});
  const [graphEdgeLabelModes, setGraphEdgeLabelModes] = useState<Record<string, string>>({});
  const [sidebarSections, setSidebarSections] = useState<Record<string, boolean>>({});
  const [queryPanelHeight, setQueryPanelHeight] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  /** Per-tab query run token — see cancelQuery / executeQuery. */
  const runTokensRef = useRef<Map<string, number>>(new Map());

  // Latest state for callbacks that must not close over a stale render (a
  // connection minted moments ago, an environment edited mid-flight).
  const envsRef  = useRef(environments);
  const connsRef = useRef(connections);
  const tabsRef  = useRef(queryTabs);
  const dynamoRuntimeRef = useRef(dynamoRuntime);
  /** Assigned further down, once the active tab's connection is derived. */
  const activeConnRef = useRef<ConnectionObject | null>(null);
  envsRef.current  = environments;
  connsRef.current = connections;
  tabsRef.current  = queryTabs;
  dynamoRuntimeRef.current = dynamoRuntime;

  /** Per-vertex-type node labelling, persisted with the workspace. */
  const setGraphLabelMode = useCallback((vertexLabel: string, mode: string) => {
    setGraphLabelModes(prev => (prev[vertexLabel] === mode ? prev : { ...prev, [vertexLabel]: mode }));
  }, []);

  const setGraphEdgeLabelMode = useCallback((edgeLabel: string, mode: string) => {
    setGraphEdgeLabelModes(prev => (prev[edgeLabel] === mode ? prev : { ...prev, [edgeLabel]: mode }));
  }, []);

  const resetGraphLabelModes = useCallback(() => {
    setGraphLabelModes({});
    setGraphEdgeLabelModes({});
  }, []);

  /** Sidebar accordion state, persisted so a closed section stays closed. */
  const setSidebarSection = useCallback((id: string, open: boolean) => {
    setSidebarSections(prev => (prev[id] === open ? prev : { ...prev, [id]: open }));
  }, []);

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

  const envConnection = useCallback(
    (env: EnvironmentObject | null | undefined): ConnectionObject | null =>
      (env?.connectionId ? connections[env.connectionId] ?? null : null),
    [connections],
  );

  const isEnvironmentConfigured = useCallback(
    (env: EnvironmentObject | null | undefined): boolean => {
      const conn = env?.connectionId ? connections[env.connectionId] : null;
      return !!conn && conn.host.trim() !== '';
    },
    [connections],
  );

  /** Same check against the freshest state, for use inside async callbacks. */
  const readEnv = useCallback((envId: string | null | undefined) => {
    const env = envId ? envsRef.current.find(e => e.id === envId) ?? null : null;
    const conn = env?.connectionId ? connsRef.current[env.connectionId] ?? null : null;
    return { env, conn, configured: !!conn && conn.host.trim() !== '' };
  }, []);

  // ── Schema ────────────────────────────────────────────────────────────────

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

  // ── Connecting ────────────────────────────────────────────────────────────

  /**
   * Open (or re-open) an endpoint. The manager in the main process closes any
   * existing handle for the id first, so this doubles as the reconnect path.
   * Returns whether the endpoint is connected afterwards, which lets Execute
   * connect-then-run instead of dead-ending on a disconnected environment.
   */
  const openConnection: (id: string, isRetry: boolean) => Promise<boolean> = useCallback(
    async (id: string, isRetry: boolean) => {
      const conn = connsRef.current[id];
      if (!conn) return false;

      updateConn(id, {
        state: 'connecting',
        statusText: isRetry ? 'Reconnecting…' : 'Connecting…',
      });
      setStatusMessage({
        message: `${isRetry ? 'Reconnecting to' : 'Connecting to'} ${conn.name}…`,
        type: 'info',
      });

      try {
        // Credentials the user just typed are still on the object. Send them
        // once, then blank them in renderer state so nothing holds them for the
        // session and no later save can carry them back out.
        const dtoWithSecrets = { ...toDto(conn), ...pickSecrets(conn) };
        const handedOverSecret = carriesSecret(dtoWithSecrets);

        const result = await graphApi.connect(dtoWithSecrets);
        if (result.success) {
          updateConn(id, {
            state: 'connected',
            statusText: `Connected${result.url ? ` — ${result.url}` : ''}`,
            ...(handedOverSecret ? { hasStoredSecret: true } : {}),
            ...clearedSecrets(),
          });
          setStatusMessage({ message: `${isRetry ? 'Reconnected to' : 'Connected to'} ${conn.name}`, type: 'info' });
          if (isRetry) notify({ type: 'success', title: `Reconnected to ${conn.name}` });
          if (conn.capabilities.supportsSchema) loadSchema(id);
          return true;
        }
        const msg = result.message ?? 'Connection failed';
        updateConn(id, { state: 'error', statusText: msg });
        reportError(`${conn.name}: connection failed`, msg, {
          label: 'Retry',
          run: () => { void openConnection(id, true); },
        });
        return false;
      } catch (err) {
        const msg = (err as Error).message;
        updateConn(id, { state: 'error', statusText: msg });
        reportError(`${conn.name}: connection failed`, msg, {
          label: 'Retry',
          run: () => { void openConnection(id, true); },
        });
        return false;
      }
    },
    [updateConn, loadSchema, notify, reportError],
  );

  const reconnectConnection = useCallback(
    async (id: string) => { await openConnection(id, true); },
    [openConnection],
  );

  // ── DynamoDB ──────────────────────────────────────────────────────────────

  /** Point the main process at one environment's table. */
  const pushDynamoConfig = useCallback(async (env: EnvironmentObject) => {
    try {
      const result = await graphApi.dynamoConfigure({
        environment: env.id,
        region: env.dynamo.region.trim() || 'us-east-1',
        tableName: env.dynamo.tableName.trim(),
        endpoint: env.dynamo.endpoint.trim(),
        profile: (env.dynamo.profile ?? '').trim(),
      });

      if (result.success) {
        const text = `${env.label} — ${result.tableName} (${result.region})`;
        setDynamoRuntime({ envId: env.id, applied: true, statusText: text });
        setStatusMessage({ message: `DynamoDB: ${text}`, type: 'info' });
      } else {
        setDynamoRuntime({ envId: env.id, applied: false, statusText: result.message ?? 'Config failed' });
        reportError(`${env.label}: DynamoDB config failed`, result.message);
      }
    } catch (err) {
      const msg = (err as Error).message;
      setDynamoRuntime({ envId: env.id, applied: false, statusText: msg });
      reportError(`${env.label}: DynamoDB config failed`, msg);
    }
  }, [reportError]);

  const applyEnvironmentDynamo = useCallback(async (envId: string) => {
    const env = envsRef.current.find(e => e.id === envId);
    if (env) await pushDynamoConfig(env);
  }, [pushDynamoConfig]);

  const handleFetchDynamoItem = useCallback((id: string) => graphApi.dynamoFetchItem(id), []);

  // ── Vertex hydration ──────────────────────────────────────────────────────

  /**
   * A `path()` traversal returns its vertices as references — id and label,
   * `properties: []` — so the graph view has nothing to label them with. This
   * reads the properties for those ids back over the same connection.
   *
   * Gremlin only for now: `elementMap()` is the one shape verified against
   * Neptune. Other dialects return an empty map, which leaves the labels
   * exactly as the query delivered them.
   */
  const hydrateElements = useCallback(
    async (step: 'V' | 'E', ids: string[]): Promise<Record<string, Record<string, unknown>>> => {
      const conn = activeConnRef.current;
      if (!conn || conn.state !== 'connected' || conn.dialect !== 'gremlin') return {};

      const unique = [...new Set(ids.filter(Boolean))].slice(0, MAX_HYDRATE_IDS);
      if (unique.length === 0) return {};

      const quote = (id: string) => `'${id.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
      const out: Record<string, Record<string, unknown>> = {};

      for (let i = 0; i < unique.length; i += HYDRATE_CHUNK) {
        const chunk = unique.slice(i, i + HYDRATE_CHUNK);
        try {
          const result = await graphApi.query({
            id: conn.id,
            query: `g.${step}(${chunk.map(quote).join(',')}).elementMap().toList()`,
            dialect: 'gremlin',
          });
          if (!result.success) continue;
          for (const row of (result.data as unknown[]) ?? []) {
            if (!row || typeof row !== 'object') continue;
            const map = row as Record<string, unknown>;
            const id = map.id;
            if (typeof id !== 'string' && typeof id !== 'number') continue;
            // `id`/`label` are element tokens rather than properties, and an
            // edge's elementMap also carries its endpoints under IN/OUT.
            const { id: _id, label: _label, IN: inV, OUT: outV, ...props } = map;
            out[String(id)] = props;

            // Neptune reports a different edge id here than the one embedded in
            // a path(), so an edge is also filed under its endpoints and type,
            // which do match. (Parallel edges of one type between the same pair
            // share an entry — they would carry the same label either way.)
            if (step === 'E') {
              const endpoint = (v: unknown) =>
                (v && typeof v === 'object' ? String((v as Record<string, unknown>).id ?? '') : String(v ?? ''));
              const from = endpoint(outV);
              const to = endpoint(inV);
              if (from && to) out[`${from}|${to}|${String(map.label ?? '')}`] = props;
            }
          }
        } catch {
          // A failed hydration is not worth interrupting the view for — the
          // elements simply keep the label they already had.
        }
      }
      return out;
    },
    [],
  );

  const hydrateVertexProperties = useCallback(
    (ids: string[]) => hydrateElements('V', ids),
    [hydrateElements],
  );

  const hydrateEdgeProperties = useCallback(
    (ids: string[]) => hydrateElements('E', ids),
    [hydrateElements],
  );

  // ── Environment actions ───────────────────────────────────────────────────

  const addEnvironment = useCallback(() => {
    const label = `Environment ${envsRef.current.length + 1}`;
    const env: EnvironmentObject = {
      id: uid('env'),
      label,
      connectionId: null,
      dynamo: { ...DEFAULT_DYNAMO },
    };
    setEnvironments(prev => [...prev, env]);
    setSelectedEnvironmentId(env.id);
  }, []);

  const renameEnvironment = useCallback((id: string, label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    setEnvironments(prev => prev.map(e => (e.id === id ? { ...e, label: trimmed } : e)));
    // The endpoint carries the environment's name into status text and errors.
    const env = envsRef.current.find(e => e.id === id);
    if (env?.connectionId) updateConn(env.connectionId, { name: trimmed });
  }, [updateConn]);

  const removeEnvironment = useCallback(async (id: string) => {
    const env = envsRef.current.find(e => e.id === id);
    if (!env) return;

    if (env.connectionId) {
      await graphApi.disconnect(env.connectionId).catch(() => undefined);
      const connId = env.connectionId;
      setConnections(prev => {
        const next = { ...prev };
        delete next[connId];
        return next;
      });
    }

    setEnvironments(prev => prev.filter(e => e.id !== id));
    setQueryTabs(prev => prev.map(t => (t.environmentId === id ? { ...t, environmentId: null } : t)));
    setSelectedEnvironmentId(prev => {
      if (prev !== id) return prev;
      return envsRef.current.find(e => e.id !== id)?.id ?? null;
    });
    if (dynamoRuntimeRef.current.envId === id) {
      setDynamoRuntime({ envId: null, applied: false, statusText: 'Not configured' });
    }
  }, []);

  const updateEnvironmentGraph = useCallback((id: string, patch: Partial<ProviderConnectionDto>) => {
    const env = envsRef.current.find(e => e.id === id);
    if (!env) return;

    if (env.connectionId && connsRef.current[env.connectionId]) {
      const next = patch as Partial<ConnectionObject>;
      // Switching database type changes what the UI may offer for it.
      if (patch.dbType) next.capabilities = capabilitiesFor(patch.dbType);
      updateConn(env.connectionId, next);
      return;
    }

    // First edit — mint the endpoint this environment owns.
    const connId = uid('conn');
    const dto = { ...makeEnvConnectionDto(connId, env.label), ...patch, id: connId };
    setConnections(prev => ({ ...prev, [connId]: makeConnection(dto, { statusText: 'Not connected' }) }));
    setEnvironments(prev => prev.map(e => (e.id === id ? { ...e, connectionId: connId } : e)));
  }, [updateConn]);

  const updateEnvironmentDynamo = useCallback((id: string, patch: Partial<DynamoConfig>) => {
    setEnvironments(prev => prev.map(e => (e.id === id ? { ...e, dynamo: { ...e.dynamo, ...patch } } : e)));
    // Editing the live environment invalidates what the main process holds.
    if (dynamoRuntimeRef.current.envId === id) {
      setDynamoRuntime(prev => ({ ...prev, applied: false, statusText: 'Edited — not applied' }));
    }
  }, []);

  const connectEnvironmentWith = useCallback(async (envId: string, isRetry: boolean) => {
    const { env, conn, configured } = readEnv(envId);
    if (!env) return;
    if (!configured || !conn) {
      reportError(
        `${env?.label ?? 'Environment'}: no endpoint configured`,
        'Set this environment’s graph endpoint in the sidebar before connecting.',
      );
      return;
    }
    await openConnection(conn.id, isRetry);
  }, [readEnv, openConnection, reportError]);

  const connectEnvironment   = useCallback((id: string) => connectEnvironmentWith(id, false), [connectEnvironmentWith]);
  const reconnectEnvironment = useCallback((id: string) => connectEnvironmentWith(id, true), [connectEnvironmentWith]);

  const disconnectEnvironment = useCallback(async (id: string) => {
    const { conn } = readEnv(id);
    if (!conn) return;
    try {
      await graphApi.disconnect(conn.id);
      updateConn(conn.id, { state: 'disconnected', statusText: 'Disconnected', schema: null, schemaError: null });
      setStatusMessage({ message: 'Disconnected', type: 'info' });
    } catch (err) {
      reportError('Disconnect failed', (err as Error).message);
    }
  }, [readEnv, updateConn, reportError]);

  // ── Tab actions ───────────────────────────────────────────────────────────

  const addTab = useCallback((environmentId: string | null = null) => {
    setQueryTabs(prev => {
      const id = uid('tab');
      // Inherit the current tab's environment, so a new tab is ready to run.
      const inherited = environmentId
        ?? prev.find(t => t.id === activeTabId)?.environmentId
        ?? null;
      const newTab = makeTab(id, `Query ${prev.length + 1}`, inherited);
      setActiveTabId(id);
      return [...prev, newTab];
    });
  }, [activeTabId]);

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
  const setTabResultView = useCallback((tabId: string, view: 'table' | 'graph' | 'json') => updateTab(tabId, { activeResultTab: view }), [updateTab]);

  /**
   * Picking an environment is a request to query it, so this also opens the
   * connection. DynamoDB follows through the active-tab effect below.
   */
  const setTabEnvironment = useCallback(async (tabId: string, environmentId: string | null) => {
    updateTab(tabId, { environmentId });
    if (!environmentId) return;

    const { env, conn, configured } = readEnv(environmentId);
    if (!env) return;
    if (!configured || !conn) {
      notify({
        type: 'warning',
        title: `${env.label} has no endpoint yet`,
        detail: 'Add its graph endpoint in the sidebar’s Environments section, then it can run queries.',
      });
      return;
    }
    if (conn.state !== 'connected' && conn.state !== 'connecting') {
      await openConnection(conn.id, false);
    }
  }, [updateTab, readEnv, openConnection, notify]);

  // ── Query execution ───────────────────────────────────────────────────────

  /**
   * Cancel the query running in a tab.
   *
   * The tab is freed at once and any result that arrives afterwards is
   * discarded. Note this does NOT stop work already accepted by the database —
   * none of the drivers in use expose a cancel — so it ends the wait, not the
   * server-side query.
   */
  const cancelQuery = useCallback((tabId: string) => {
    const token = runTokensRef.current.get(tabId);
    if (token === undefined) return;

    // Bumping the token orphans the in-flight run.
    runTokensRef.current.set(tabId, token + 1);
    updateTab(tabId, { isExecuting: false, error: null });
    setStatusMessage({ message: 'Query cancelled', type: 'info' });
    notify({
      type: 'info',
      title: 'Query cancelled',
      detail:
        'The tab is free again. The database may still be finishing the query — ' +
        'the drivers used here have no way to call it back.',
    });
  }, [updateTab, notify]);

  const executeQuery = useCallback(async (tabId: string) => {
    const tab = tabsRef.current.find(t => t.id === tabId);
    if (!tab?.query.trim()) {
      setStatusMessage({ message: 'Enter a query first', type: 'error' });
      return;
    }
    if (tab.isExecuting) return;

    const { env, conn, configured } = readEnv(tab.environmentId);
    if (!env || !configured || !conn) {
      reportError(
        'No environment selected',
        'Pick an environment above the editor, or set one up in the sidebar’s Environments section.',
      );
      return;
    }

    // A disconnected environment is not a dead end: connect, then run.
    if (conn.state !== 'connected') {
      const opened = await openConnection(conn.id, false);
      if (!opened) return; // openConnection already reported why.
    }

    // Identifies this run; a Stop (or a later run in the same tab) increments
    // it, and any result carrying a stale token is dropped on arrival.
    const runToken = (runTokensRef.current.get(tabId) ?? 0) + 1;
    runTokensRef.current.set(tabId, runToken);
    const isCurrentRun = () => runTokensRef.current.get(tabId) === runToken;

    updateTab(tabId, { isExecuting: true, error: null });
    setStatusMessage({ message: `Executing on ${env.label}…`, type: 'info' });

    const failTab = (message: string) => {
      if (!isCurrentRun()) return;
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
        `Query failed on ${env.label}`,
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

      // Cancelled, or superseded by a newer run in this tab.
      if (!isCurrentRun()) return;

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
  }, [readEnv, updateTab, updateConn, openConnection, reportError, notify]);

  // ── Workspace persistence ─────────────────────────────────────────────────

  // Load once on mount, before any save can run.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await graphApi.workspaceLoad();
        if (cancelled) return;

        if (!res.success && res.message) {
          notify({
            type: 'warning',
            title: 'Saved workspace could not be read',
            detail: `${res.message} — starting with an empty workspace.`,
          });
        }

        const state = res.state;
        if (state) {
          // Endpoints first: environments and tabs reference them by id.
          // The main process holds the credentials; it tells us only which
          // connections have one, so the UI knows whether to prompt.
          const withSecrets = new Set(res.connectionsWithSecrets ?? []);

          const restored: Record<string, ConnectionObject> = {};
          for (const dto of state.connections ?? []) {
            restored[dto.id] = makeConnection(dto, {
              statusText: 'Saved — not connected',
              hasStoredSecret: withSecrets.has(dto.id),
            });
          }

          if (Object.keys(restored).length > 0) {
            setConnections(restored);
            if (!res.secretsAvailable) {
              notify({
                type: 'warning',
                title: 'Saved credentials were not restored',
                detail:
                  'This machine’s OS keychain is unavailable, so passwords and tokens were not written to disk. ' +
                  'Re-enter them on the affected environments before connecting.',
              });
            }
          }

          const envs = restoreEnvironments(state, restored);
          setEnvironments(envs);

          const selected = state.ui?.selectedEnvironmentId && envs.some(e => e.id === state.ui!.selectedEnvironmentId)
            ? state.ui!.selectedEnvironmentId!
            : envs[0]?.id ?? null;
          setSelectedEnvironmentId(selected);

          if (state.tabs.length > 0) {
            const tabs = state.tabs.map(t => ({
              ...makeTab(t.id, t.name, resolveTabEnvironment(t, envs)),
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

          if (state.ui?.graphLabelProperty) setGraphLabelProperty(state.ui.graphLabelProperty);
          if (state.ui?.graphLabelModes) setGraphLabelModes(state.ui.graphLabelModes);
          if (state.ui?.graphEdgeLabelModes) setGraphEdgeLabelModes(state.ui.graphEdgeLabelModes);
          if (state.ui?.sidebarSections) setSidebarSections(state.ui.sidebarSections);
          if (state.ui?.queryPanelHeight) setQueryPanelHeight(state.ui.queryPanelHeight);

          setStatusMessage({
            message: `Workspace restored — ${envs.length} environment(s), ${state.tabs.length} tab(s)`,
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
    // Runs once — notify is stable enough for a mount-only load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const serializeWorkspace = useCallback((): WorkspaceState => ({
    version: 1,
    connections: Object.values(connections).map(toDto),
    // Kept for builds that predate environments; the sidebar no longer uses it.
    activeConnectionId: environments.find(e => e.id === selectedEnvironmentId)?.connectionId ?? null,
    tabs: queryTabs.map<PersistedTab>(t => ({
      id: t.id,
      name: t.name,
      query: t.query,
      environmentId: t.environmentId,
      connectionId: environments.find(e => e.id === t.environmentId)?.connectionId ?? null,
      activeResultTab: t.activeResultTab,
      history: t.history,
    })),
    activeTabId,
    environments: environments.map<PersistedEnvironment>(e => ({
      id: e.id,
      label: e.label,
      connectionId: e.connectionId,
      dynamo: e.dynamo,
    })),
    // Legacy mirror, so an older build still finds its DynamoDB environments.
    dynamo: {
      environment: dynamoRuntime.envId ?? environments[0]?.id ?? 'local',
      environments: Object.fromEntries(
        environments.map(e => [e.id, { label: e.label, ...e.dynamo }]),
      ),
    },
    ui: {
      graphLabelProperty,
      graphLabelModes,
      graphEdgeLabelModes,
      sidebarSections,
      ...(selectedEnvironmentId ? { selectedEnvironmentId } : {}),
      ...(queryPanelHeight ? { queryPanelHeight } : {}),
    },
  }), [connections, environments, selectedEnvironmentId, queryTabs, activeTabId, dynamoRuntime.envId, graphLabelProperty, graphLabelModes, graphEdgeLabelModes, sidebarSections, queryPanelHeight]);

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

  /**
   * Last-chance flush for edits made inside the debounce window.
   *
   * `beforeunload` cannot await, so firing an async save from it never
   * completed — the window was gone first, and the last edit was lost. Saving
   * on every visibility change and blur instead means the work is already on
   * disk by the time a close begins; `beforeunload` stays as a final nudge.
   */
  useEffect(() => {
    if (!hydrated) return;

    const flush = () => { void graphApi.workspaceSave(serializeRef.current()).catch(() => undefined); };

    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', flush);
      window.removeEventListener('beforeunload', flush);
      // Unmount is also a close: get the current state down.
      flush();
    };
  }, [hydrated]);

  // ── Derived tab state ─────────────────────────────────────────────────────

  const activeTab = useMemo(
    () => queryTabs.find(t => t.id === activeTabId) ?? queryTabs[0] ?? null,
    [queryTabs, activeTabId],
  );

  const activeTabEnvironment = useMemo(
    () => environments.find(e => e.id === activeTab?.environmentId) ?? null,
    [environments, activeTab?.environmentId],
  );

  const activeTabConnection = useMemo(
    () => (activeTabEnvironment?.connectionId ? connections[activeTabEnvironment.connectionId] ?? null : null),
    [activeTabEnvironment, connections],
  );
  activeConnRef.current = activeTabConnection;

  const configuredEnvironments = useMemo(
    () => environments.filter(e => e.connectionId && connections[e.connectionId]?.host.trim()),
    [environments, connections],
  );

  // ── DynamoDB follows the active tab's environment ──────────────────────────

  // Identity only: re-pushing on every keystroke would fight the editor, so
  // edits are applied explicitly (Apply) while switching tabs is automatic.
  const activeEnvId = activeTabEnvironment?.id ?? null;

  useEffect(() => {
    if (!hydrated || !activeEnvId) return;
    const env = envsRef.current.find(e => e.id === activeEnvId);
    if (!env) return;
    if (dynamoRuntimeRef.current.envId === env.id && dynamoRuntimeRef.current.applied) return;
    void pushDynamoConfig(env);
  }, [hydrated, activeEnvId, pushDynamoConfig]);

  // ── Connection health polling ─────────────────────────────────────────────

  // A dropped websocket is otherwise invisible until the next query fails; this
  // flips the environment to "Connection lost" and offers a reconnect.
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
            action: { label: 'Reconnect', run: () => { void openConnection(id, true); } },
          });
        } catch {
          // A failed probe alone is not proof the link is down; the next
          // query surfaces a real error with better context.
        }
      }
    };

    const timer = setInterval(poll, HEALTH_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [connectedIds, updateConn, notify, openConnection]);

  /**
   * Memoised so the provider does not hand every consumer a new object on each
   * render. Without this, any state change anywhere re-rendered the whole tree
   * — including the canvas graph views — on every keystroke.
   */
  const value: AppContextValue = useMemo(() => ({
    environments,
    configuredEnvironments,
    selectedEnvironmentId,
    setSelectedEnvironmentId,
    addEnvironment,
    removeEnvironment,
    renameEnvironment,
    updateEnvironmentGraph,
    updateEnvironmentDynamo,
    applyEnvironmentDynamo,
    connectEnvironment,
    reconnectEnvironment,
    disconnectEnvironment,
    envConnection,
    isEnvironmentConfigured,
    connections,
    loadSchema,
    reconnectConnection,
    queryTabs,
    activeTabId,
    activeTab,
    activeTabEnvironment,
    activeTabConnection,
    setActiveTabId,
    addTab,
    closeTab,
    renameTab,
    setTabQuery,
    setTabEnvironment,
    setTabResultView,
    executeQuery,
    cancelQuery,
    statusMessage,
    setStatusMessage,
    notifications,
    notify,
    dismissNotification,
    clearNotifications,
    dynamoRuntime,
    handleFetchDynamoItem,
    hydrateVertexProperties,
    hydrateEdgeProperties,
    graphLabelProperty,
    setGraphLabelProperty,
    graphLabelModes,
    setGraphLabelMode,
    graphEdgeLabelModes,
    setGraphEdgeLabelMode,
    resetGraphLabelModes,
    sidebarSections,
    setSidebarSection,
    queryPanelHeight,
    setQueryPanelHeight,
    hydrated,
  }), [
    environments,
    configuredEnvironments,
    selectedEnvironmentId,
    setSelectedEnvironmentId,
    addEnvironment,
    removeEnvironment,
    renameEnvironment,
    updateEnvironmentGraph,
    updateEnvironmentDynamo,
    applyEnvironmentDynamo,
    connectEnvironment,
    reconnectEnvironment,
    disconnectEnvironment,
    envConnection,
    isEnvironmentConfigured,
    connections,
    loadSchema,
    reconnectConnection,
    queryTabs,
    activeTabId,
    activeTab,
    activeTabEnvironment,
    activeTabConnection,
    setActiveTabId,
    addTab,
    closeTab,
    renameTab,
    setTabQuery,
    setTabEnvironment,
    setTabResultView,
    executeQuery,
    cancelQuery,
    statusMessage,
    setStatusMessage,
    notifications,
    notify,
    dismissNotification,
    clearNotifications,
    dynamoRuntime,
    handleFetchDynamoItem,
    hydrateVertexProperties,
    hydrateEdgeProperties,
    graphLabelProperty,
    setGraphLabelProperty,
    graphLabelModes,
    setGraphLabelMode,
    graphEdgeLabelModes,
    setGraphEdgeLabelMode,
    resetGraphLabelModes,
    sidebarSections,
    setSidebarSection,
    queryPanelHeight,
    setQueryPanelHeight,
    hydrated,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// ── Workspace migration ───────────────────────────────────────────────────────

/**
 * Environments as saved, or built from a pre-environment workspace: the legacy
 * DynamoDB environment map supplies labels and tables, and each saved
 * connection is attached to the environment whose label matches its name
 * (that is how these were named in practice). Anything left over becomes its
 * own environment, so no configured endpoint is lost in the migration.
 */
function restoreEnvironments(
  state: WorkspaceState,
  connections: Record<string, ConnectionObject>,
): EnvironmentObject[] {
  if (Array.isArray(state.environments) && state.environments.length > 0) {
    return state.environments.map(e => ({
      id: e.id,
      label: e.label,
      connectionId: e.connectionId && connections[e.connectionId] ? e.connectionId : null,
      dynamo: { ...DEFAULT_DYNAMO, ...e.dynamo },
    }));
  }

  const legacy = state.dynamo?.environments;
  const envs: EnvironmentObject[] = legacy && Object.keys(legacy).length > 0
    ? Object.entries(legacy).map(([id, env]) => ({
        id,
        label: env.label,
        connectionId: null,
        dynamo: { region: env.region, tableName: env.tableName, endpoint: env.endpoint, profile: env.profile },
      }))
    : seedEnvironments();

  for (const conn of Object.values(connections)) {
    const match = envs.find(e => !e.connectionId && e.label.toLowerCase() === conn.name.trim().toLowerCase());
    if (match) match.connectionId = conn.id;
    else envs.push({ id: uid('env'), label: conn.name, connectionId: conn.id, dynamo: { ...DEFAULT_DYNAMO } });
  }

  return envs;
}

/** A persisted tab's environment, falling back to whoever owns its connection. */
function resolveTabEnvironment(tab: PersistedTab, envs: EnvironmentObject[]): string | null {
  if (tab.environmentId && envs.some(e => e.id === tab.environmentId)) return tab.environmentId;
  if (tab.connectionId) return envs.find(e => e.connectionId === tab.connectionId)?.id ?? null;
  return null;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
