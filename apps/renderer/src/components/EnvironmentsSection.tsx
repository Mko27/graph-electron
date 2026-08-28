/**
 * EnvironmentsSection — the one place an environment is set up.
 *
 * An environment owns a graph endpoint *and* a DynamoDB source, so the two can
 * never point at different stages. The list picks which environment to edit;
 * the editor below it holds two blocks — the AWS/graph endpoint and the
 * DynamoDB table — each collapsible so a long form stays manageable.
 *
 * Only environments with an endpoint appear in a query tab's picker; the "use
 * in this tab" arrow on a row is the shortcut for pointing the current tab at
 * one without going through the dropdown.
 *
 * Renaming happens on the row itself — the pencil beside that arrow, or a
 * double-click on the name — so the editor below carries a plain heading rather
 * than a text field that is only occasionally wanted.
 */

import { useState, useRef, useEffect } from 'react';
import { useApp } from '../state/AppContext';
import type { EnvironmentObject } from '../state/AppContext';
import {
  DB_TYPE_LABELS,
  DIALECT_LABELS,
  DIALECT_COMPATIBILITY,
  DEFAULT_PORTS,
} from '@graph-client/shared';
import type { ProviderConnectionDto } from '@graph-client/shared';
import { CollapsibleSection } from './CollapsibleSection';
import { AwsProfileSelect } from './AwsProfileSelect';

export const SECTION_ENVIRONMENTS = 'environments';

// ── Icons ─────────────────────────────────────────────────────────────────────

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const IconLayers = (
  <svg width="15" height="15" {...svgProps}>
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);

const IconCloud = (
  <svg width="14" height="14" {...svgProps}>
    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
  </svg>
);

const IconTable = (
  <svg width="14" height="14" {...svgProps}>
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
  </svg>
);

const IconPlus = (
  <svg width="14" height="14" {...svgProps} strokeWidth={2.5}>
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const IconArrowRight = (
  <svg width="12" height="12" {...svgProps} strokeWidth={2.5}>
    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
  </svg>
);

const IconPencil = (
  <svg width="12" height="12" {...svgProps}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);

const IconTrash = (
  <svg width="12" height="12" {...svgProps}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-2 14H7L5 6" />
    <path d="M10 11v6M14 11v6M9 6V4h6v2" />
  </svg>
);

const IconShield = (
  <svg width="14" height="14" {...svgProps}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

// ── Auth fields that depend on the database type ──────────────────────────────

function DbAuthFields({
  dbType,
  conn,
  set,
}: {
  dbType: string;
  conn: ProviderConnectionDto | null;
  set: (patch: Partial<ProviderConnectionDto>) => void;
}) {
  const text = (k: keyof ProviderConnectionDto) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set({ [k]: e.target.value } as Partial<ProviderConnectionDto>);
  const val = (k: keyof ProviderConnectionDto) => String((conn?.[k] as string | undefined) ?? '');

  switch (dbType) {
    case 'neptune':
      return (
        <>
          <div className="form-group">
            <label>AWS Region <span className="form-hint">(optional)</span></label>
            <input type="text" placeholder="us-east-1" value={val('region')} onChange={text('region')} />
          </div>
          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={conn?.useIamAuth !== false}
                onChange={e => set({ useIamAuth: e.target.checked })}
              />
              <span>Use IAM Auth (SigV4)</span>
            </label>
          </div>
          <AwsProfileSelect value={val('profile')} onChange={profile => set({ profile })} />
        </>
      );

    case 'neo4j':
    case 'orientdb':
    case 'nebula':
      return (
        <>
          <div className="form-group">
            <label>Username</label>
            <input type="text" placeholder="neo4j" value={val('username')} onChange={text('username')} />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" placeholder="••••••••" value={val('password')} onChange={text('password')} />
          </div>
          {dbType === 'neo4j' && (
            <div className="form-group">
              <label>Database <span className="form-hint">(optional)</span></label>
              <input type="text" placeholder="neo4j" value={val('database')} onChange={text('database')} />
            </div>
          )}
          {dbType === 'nebula' && (
            <div className="form-group">
              <label>Space <span className="form-hint">(optional)</span></label>
              <input type="text" placeholder="my_space" value={val('space')} onChange={text('space')} />
            </div>
          )}
        </>
      );

    case 'arangodb':
      return (
        <>
          <div className="form-group">
            <label>Username <span className="form-hint">(optional)</span></label>
            <input type="text" placeholder="root" value={val('username')} onChange={text('username')} />
          </div>
          <div className="form-group">
            <label>Password <span className="form-hint">(optional)</span></label>
            <input type="password" placeholder="••••••••" value={val('password')} onChange={text('password')} />
          </div>
          <div className="form-group">
            <label>Database <span className="form-hint">(optional)</span></label>
            <input type="text" placeholder="_system" value={val('database')} onChange={text('database')} />
          </div>
        </>
      );

    case 'cosmosdb':
      return (
        <>
          <div className="form-group">
            <label>Primary Key</label>
            <input type="password" placeholder="Azure primary key" value={val('primaryKey')} onChange={text('primaryKey')} />
          </div>
          <div className="form-group">
            <label>Database</label>
            <input type="text" placeholder="mydb" value={val('database')} onChange={text('database')} />
          </div>
          <div className="form-group">
            <label>Collection</label>
            <input type="text" placeholder="mygraph" value={val('collection')} onChange={text('collection')} />
          </div>
        </>
      );

    case 'tigergraph':
      return (
        <>
          <div className="form-group">
            <label>Graph Name <span className="form-hint">(optional)</span></label>
            <input type="text" placeholder="MyGraph" value={val('graphName')} onChange={text('graphName')} />
          </div>
          <div className="form-group">
            <label>Bearer Token <span className="form-hint">(optional)</span></label>
            <input type="password" placeholder="token" value={val('token')} onChange={text('token')} />
          </div>
        </>
      );

    default:
      return null;
  }
}

// ── One row in the environment list ───────────────────────────────────────────

function EnvironmentRow({ env, selected, inActiveTab }: {
  env: EnvironmentObject;
  selected: boolean;
  inActiveTab: boolean;
}) {
  const {
    envConnection, isEnvironmentConfigured, setSelectedEnvironmentId,
    setTabEnvironment, activeTabId, renameEnvironment,
  } = useApp();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(env.label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const conn = envConnection(env);
  const configured = isEnvironmentConfigured(env);
  const state = configured ? conn!.state : 'disconnected';

  const startEditing = () => { setDraft(env.label); setEditing(true); };

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== env.label) renameEnvironment(env.id, trimmed);
  };

  return (
    <div
      className={`env-row ${selected ? 'selected' : ''} ${inActiveTab ? 'in-tab' : ''}`}
      onClick={() => setSelectedEnvironmentId(env.id)}
      title={
        editing ? undefined
          : configured ? `${conn!.host}:${conn!.port} — ${conn!.statusText}`
          : 'No endpoint yet'
      }
    >
      <span className={`conn-dot ${state}`} />

      {editing ? (
        // Chips and actions step aside so the name has the whole row.
        <input
          ref={inputRef}
          className="env-row-input"
          value={draft}
          aria-label="Environment name"
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
            e.stopPropagation();
          }}
        />
      ) : (
        <>
          <span
            className="env-row-label"
            onDoubleClick={e => { e.stopPropagation(); startEditing(); }}
          >
            {env.label}
          </span>
          {!configured && <span className="sb-chip">no endpoint</span>}
          {configured && env.dynamo.tableName && <span className="sb-chip">{env.dynamo.tableName}</span>}
          {inActiveTab && <span className="sb-chip accent" title="Used by the active query tab">in tab</span>}
          <span className="env-row-actions">
            <button
              className="btn-icon env-edit-btn"
              title={`Rename ${env.label}`}
              onClick={e => { e.stopPropagation(); startEditing(); }}
            >
              {IconPencil}
            </button>
            {configured && !inActiveTab && (
              <button
                className="btn-icon env-use-btn"
                title="Use in the active query tab"
                onClick={e => { e.stopPropagation(); void setTabEnvironment(activeTabId, env.id); }}
              >
                {IconArrowRight}
              </button>
            )}
          </span>
        </>
      )}
    </div>
  );
}

// ── Editor for the selected environment ───────────────────────────────────────

function EnvironmentEditor({ env }: { env: EnvironmentObject }) {
  const {
    envConnection, isEnvironmentConfigured,
    removeEnvironment,
    updateEnvironmentGraph, updateEnvironmentDynamo, applyEnvironmentDynamo,
    connectEnvironment, reconnectEnvironment, disconnectEnvironment,
    dynamoRuntime,
  } = useApp();

  const [shownEnvId, setShownEnvId] = useState(env.id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  // A pending delete must not carry over to the next environment selected.
  if (shownEnvId !== env.id) {
    setShownEnvId(env.id);
    setConfirmDelete(false);
  }

  const conn = envConnection(env);
  const configured = isEnvironmentConfigured(env);
  const dbType  = conn?.dbType ?? 'neptune';
  const dialect = conn?.dialect ?? 'gremlin';
  const dialects = DIALECT_COMPATIBILITY[dbType] ?? ['gremlin'];

  const setGraph = (patch: Partial<ProviderConnectionDto>) => updateEnvironmentGraph(env.id, patch);
  const setDynamo = (field: 'region' | 'tableName' | 'endpoint') =>
    (e: React.ChangeEvent<HTMLInputElement>) => updateEnvironmentDynamo(env.id, { [field]: e.target.value });

  const onDbTypeChange = (next: string) => {
    const nextDialects = DIALECT_COMPATIBILITY[next] ?? ['gremlin'];
    setGraph({ dbType: next, dialect: nextDialects[0], port: DEFAULT_PORTS[next] ?? 8182 });
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };

  const state = conn?.state ?? 'disconnected';
  const isConnected  = state === 'connected';
  const isConnecting = state === 'connecting';
  const dynamoLive = dynamoRuntime.envId === env.id;

  // The header chip is narrow, so it carries a state word and leaves the full
  // status text (which can be a whole provider error) to the tooltip.
  const stateWord = !configured
    ? 'not set'
    : isConnecting ? 'connecting…'
    : isConnected ? 'connected'
    : state === 'error' ? 'error'
    : 'not connected';

  return (
    <div className="env-editor">
      <div className="env-editor-head">
        <span className="env-editor-title" title={env.label}>{env.label}</span>
        {confirmDelete ? (
          <span className="env-delete-confirm">
            <button className="btn-sm btn-danger-sm" onClick={() => { void removeEnvironment(env.id); }}>
              Delete
            </button>
            <button className="btn-sm btn-neutral-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </span>
        ) : (
          <button
            className="btn-icon env-delete-btn"
            title={`Delete ${env.label}`}
            onClick={() => setConfirmDelete(true)}
          >
            {IconTrash}
          </button>
        )}
      </div>

      {/* ── Graph endpoint ── */}
      <CollapsibleSection
        id="env-graph"
        title="AWS · Graph endpoint"
        icon={IconCloud}
        nested
        summary={
          <span
            className={`sb-chip ${isConnected ? 'ok' : state === 'error' ? 'bad' : ''}`}
            title={conn?.statusText}
          >
            {stateWord}
          </span>
        }
      >
        <div className="form-row">
          <div className="form-group" style={{ flex: 1, minWidth: 0 }}>
            <label>Database</label>
            <select className="conn-select" style={{ width: '100%' }} value={dbType} onChange={e => onDbTypeChange(e.target.value)}>
              {Object.entries(DB_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ flex: 1, minWidth: 0 }}>
            <label>Dialect</label>
            <select className="conn-select" style={{ width: '100%' }} value={dialect} onChange={e => setGraph({ dialect: e.target.value })}>
              {dialects.map(d => (
                <option key={d} value={d}>{DIALECT_LABELS[d] ?? d}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label>Endpoint</label>
          <input
            type="text"
            placeholder={dbType === 'neptune' ? 'cluster.region.neptune.amazonaws.com' : 'localhost'}
            value={conn?.host ?? ''}
            onChange={e => setGraph({ host: e.target.value })}
          />
        </div>

        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label>Port</label>
            <input
              type="number"
              value={String(conn?.port ?? DEFAULT_PORTS[dbType] ?? 8182)}
              onChange={e => setGraph({ port: parseInt(e.target.value, 10) || DEFAULT_PORTS[dbType] || 8182 })}
            />
          </div>
          <div className="form-group checkbox-group" style={{ paddingTop: 20 }}>
            <label>
              <input type="checkbox" checked={conn?.ssl !== false} onChange={e => setGraph({ ssl: e.target.checked })} />
              <span>SSL</span>
            </label>
          </div>
        </div>

        <DbAuthFields dbType={dbType} conn={conn} set={setGraph} />

        <div className="env-actions">
          {isConnecting ? (
            <span className="conn-state-text connecting">
              <span className="loading-spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> Connecting…
            </span>
          ) : isConnected ? (
            <>
              <button className="btn-sm btn-primary-sm" disabled={busy} onClick={() => { void run(() => reconnectEnvironment(env.id)); }}>
                Reconnect
              </button>
              <button className="btn-sm btn-danger-sm" disabled={busy} onClick={() => { void run(() => disconnectEnvironment(env.id)); }}>
                Disconnect
              </button>
            </>
          ) : (
            <button
              className="btn-sm btn-primary-sm"
              disabled={!configured || busy}
              title={configured ? 'Open this environment’s connection' : 'Set an endpoint first'}
              onClick={() => { void run(() => connectEnvironment(env.id)); }}
            >
              {state === 'error' ? 'Retry' : 'Connect'}
            </button>
          )}
          <span className={`conn-state-text ${state}`} title={conn?.statusText}>
            {configured ? conn?.statusText : 'No endpoint yet'}
          </span>
        </div>
      </CollapsibleSection>

      {/* ── DynamoDB source ── */}
      <CollapsibleSection
        id="env-dynamo"
        title="DynamoDB source"
        icon={IconTable}
        nested
        summary={
          <span className={`sb-chip ${dynamoLive && dynamoRuntime.applied ? 'ok' : ''}`}>
            {env.dynamo.tableName || 'no table'}
          </span>
        }
      >
        <div className="form-group">
          <label>Table Name</label>
          <input type="text" placeholder="blocks" value={env.dynamo.tableName} onChange={setDynamo('tableName')} />
        </div>
        <div className="form-group">
          <label>AWS Region</label>
          <input type="text" placeholder="us-east-1" value={env.dynamo.region} onChange={setDynamo('region')} />
        </div>
        <div className="form-group">
          <label>Endpoint <span className="form-hint">(blank = real AWS)</span></label>
          <input type="text" placeholder="http://localhost:8000" value={env.dynamo.endpoint} onChange={setDynamo('endpoint')} />
        </div>
        <AwsProfileSelect
          value={env.dynamo.profile ?? ''}
          onChange={profile => updateEnvironmentDynamo(env.id, { profile })}
        />
        <button
          className="btn btn-ghost"
          style={{ width: '100%' }}
          disabled={busy}
          onClick={() => { void run(() => applyEnvironmentDynamo(env.id)); }}
        >
          {IconShield}
          {busy ? 'Applying…' : 'Apply DynamoDB Config'}
        </button>
        <div
          className={`dynamo-config-status ${dynamoLive && dynamoRuntime.applied ? 'applied' : 'pending'}`}
          title={dynamoLive ? dynamoRuntime.statusText : 'Becomes live when a tab uses this environment'}
        >
          <span className="dynamo-dot" />
          <span>{dynamoLive ? dynamoRuntime.statusText : 'Not the active tab’s environment'}</span>
        </div>
      </CollapsibleSection>
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

export function EnvironmentsSection() {
  const {
    environments, selectedEnvironmentId, addEnvironment,
    activeTabEnvironment, activeTabConnection, setSidebarSection,
  } = useApp();

  const selected = environments.find(e => e.id === selectedEnvironmentId) ?? null;

  const onAdd = () => {
    setSidebarSection(SECTION_ENVIRONMENTS, true);
    addEnvironment();
  };

  const summary = activeTabEnvironment
    ? (
      <span className="sb-chip">
        <span className={`conn-dot ${activeTabConnection?.state ?? 'disconnected'}`} />
        {activeTabEnvironment.label}
      </span>
    )
    : <span className="sb-chip">no environment</span>;

  return (
    <CollapsibleSection
      id={SECTION_ENVIRONMENTS}
      tone="primary"
      title="Environments"
      icon={IconLayers}
      summary={summary}
      actions={
        <button className="btn-icon" title="Add environment" onClick={onAdd}>
          {IconPlus}
        </button>
      }
    >
      <p className="sb-hint">
        Each environment pairs a graph endpoint with a DynamoDB table. Query tabs
        pick from the ones that have an endpoint.
      </p>

      {environments.length === 0 ? (
        <div className="empty-state">
          No environments.{' '}
          <button className="link-btn" onClick={onAdd}>Add one</button>
        </div>
      ) : (
        <div className="env-list">
          {environments.map(env => (
            <EnvironmentRow
              key={env.id}
              env={env}
              selected={env.id === selectedEnvironmentId}
              inActiveTab={env.id === activeTabEnvironment?.id}
            />
          ))}
        </div>
      )}

      {selected && <EnvironmentEditor env={selected} />}
    </CollapsibleSection>
  );
}
