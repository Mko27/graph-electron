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
 */

import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { graphApi } from '../api/graphApi';
import {
  PROVIDER_CAPABILITIES,
  DEFAULT_PORTS,
} from '@graph-client/shared';
import type { ProviderConnectionDto, GraphSchemaResponse, UICapabilities } from '@graph-client/shared';

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

interface AppContextValue {
  connections: Record<string, ConnectionObject>;
  activeConnectionId: string | null;
  setActiveConnectionId: (id: string | null) => void;
  addConnection: (dto: ProviderConnectionDto) => string;
  connectConnection: (id: string) => Promise<void>;
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
  handleDynamoConfig: (region: string, tableName: string, endpoint?: string) => Promise<{ success: boolean; tableName?: string; region?: string; message?: string }>;
  handleFetchDynamoItem: (id: string) => Promise<{ success: boolean; data?: Record<string, unknown> | null; message?: string }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const uid = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

function makeConnection(dto: ProviderConnectionDto): ConnectionObject {
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

// ── Context ───────────────────────────────────────────────────────────────────

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [connections, setConnections] = useState<Record<string, ConnectionObject>>({});
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);

  const initialTabId = uid('tab');
  const [queryTabs, setQueryTabs] = useState<TabObject[]>(() => [makeTab(initialTabId, 'Query 1')]);
  const [activeTabId, setActiveTabId] = useState<string>(initialTabId);
  const [statusMessage, setStatusMessage] = useState<{ message: string; type: 'info' | 'error' }>({
    message: 'Ready',
    type: 'info',
  });

  // ── State helpers ─────────────────────────────────────────────────────────

  const updateConn = useCallback((id: string, updates: Partial<ConnectionObject>) => {
    setConnections(prev => ({ ...prev, [id]: { ...prev[id], ...updates } }));
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

  const loadSchema = useCallback(async (connectionId: string) => {
    updateConn(connectionId, { schemaLoading: true, schemaError: null });
    try {
      const result = await graphApi.schema(connectionId);
      if (result.success) {
        updateConn(connectionId, { schema: result, schemaLoading: false });
      } else {
        updateConn(connectionId, { schemaError: result.message ?? 'Schema failed', schemaLoading: false });
      }
    } catch (err) {
      updateConn(connectionId, { schemaError: (err as Error).message, schemaLoading: false });
    }
  }, [updateConn]);

  const connectConnection = useCallback(async (id: string) => {
    const conn = connections[id];
    if (!conn) return;

    updateConn(id, { state: 'connecting', statusText: 'Connecting…' });
    try {
      const result = await graphApi.connect(conn);
      if (result.success) {
        updateConn(id, { state: 'connected', statusText: `Connected${result.url ? ` — ${result.url}` : ''}` });
        setStatusMessage({ message: `Connected to ${conn.name}`, type: 'info' });
        if (conn.capabilities.supportsSchema) {
          loadSchema(id);
        }
      } else {
        updateConn(id, { state: 'error', statusText: result.message ?? 'Connection failed' });
        setStatusMessage({ message: result.message ?? 'Connection failed', type: 'error' });
      }
    } catch (err) {
      const msg = (err as Error).message;
      updateConn(id, { state: 'error', statusText: msg });
      setStatusMessage({ message: msg, type: 'error' });
    }
  }, [connections, updateConn, loadSchema]);

  const disconnectConnection = useCallback(async (id: string) => {
    try {
      await graphApi.disconnect(id);
      updateConn(id, { state: 'disconnected', statusText: 'Disconnected' });
      setStatusMessage({ message: 'Disconnected', type: 'info' });
    } catch (err) {
      setStatusMessage({ message: (err as Error).message, type: 'error' });
    }
  }, [updateConn]);

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
      setStatusMessage({ message: 'No active connection. Connect a database first.', type: 'error' });
      return;
    }

    updateTab(tabId, { isExecuting: true, error: null });
    setStatusMessage({ message: `Executing on ${conn.name}…`, type: 'info' });

    try {
      const result = await graphApi.query({
        id: conn.id,
        query: tab.query.trim(),
        dialect: conn.dialect,
      });

      const historyEntry = {
        query: tab.query.trim(),
        success: result.success ?? false,
        timestamp: new Date().toLocaleTimeString(),
      };

      if (result.success) {
        updateTab(tabId, {
          result: {
            data: (result.data as unknown[]) ?? [],
            duration: result.duration ?? 0,
            count: result.count ?? 0,
          },
          error: null,
          isExecuting: false,
          history: [historyEntry, ...tab.history].slice(0, 50),
        });
        setStatusMessage({
          message: `Done in ${result.duration}ms — ${result.count} result${result.count !== 1 ? 's' : ''}`,
          type: 'info',
        });
      } else {
        updateTab(tabId, {
          error: result.message ?? 'Query failed',
          isExecuting: false,
          history: [historyEntry, ...tab.history].slice(0, 50),
        });
        setStatusMessage({ message: result.message ?? 'Query failed', type: 'error' });
      }
    } catch (err) {
      const msg = (err as Error).message;
      updateTab(tabId, { error: msg, isExecuting: false });
      setStatusMessage({ message: msg, type: 'error' });
    }
  }, [queryTabs, resolveConnection, updateTab]);

  // ── DynamoDB ──────────────────────────────────────────────────────────────

  const handleDynamoConfig = useCallback(async (region: string, tableName: string, endpoint?: string) => {
    try {
      const result = await graphApi.dynamoConfigure(region, tableName, endpoint);
      setStatusMessage(
        result.success
          ? { message: `DynamoDB: ${result.tableName} (${result.region})`, type: 'info' }
          : { message: `DynamoDB config failed: ${result.message}`, type: 'error' },
      );
      return result;
    } catch (err) {
      const msg = (err as Error).message;
      setStatusMessage({ message: `DynamoDB error: ${msg}`, type: 'error' });
      return { success: false, message: msg };
    }
  }, []);

  const handleFetchDynamoItem = useCallback((id: string) => graphApi.dynamoFetchItem(id), []);

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
    connectConnection,
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
    handleDynamoConfig,
    handleFetchDynamoItem,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
