/**
 * DynamoModal — full-screen overlay to display DynamoDB item data.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../state/AppContext';

function DynamoValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="dynamo-val-null">null</span>;
  }
  if (typeof value === 'boolean') {
    return <span className="dynamo-val-bool">{String(value)}</span>;
  }
  if (typeof value === 'number') {
    return <span className="dynamo-val-number">{value}</span>;
  }
  if (typeof value === 'string') {
    return <span className={`dynamo-val-string${value.length > 200 ? ' dynamo-val-long' : ''}`}>{value}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="dynamo-val-null">[]</span>;
    return (
      <div className="dynamo-val-array">
        {value.map((item, i) => (
          <div key={i} className="dynamo-val-array-item">
            <span className="dynamo-val-array-idx">[{i}]</span>
            <DynamoValue value={item} />
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="dynamo-val-null">{'{}'}</span>;
    return (
      <div className="dynamo-val-object">
        {entries.map(([k, v]) => (
          <div key={k} className="dynamo-val-object-row">
            <span className="dynamo-val-object-key">{k}:</span>
            <DynamoValue value={v} />
          </div>
        ))}
      </div>
    );
  }
  return <span className="dynamo-val-string">{String(value)}</span>;
}

export function DynamoModal({
  id,
  graphItem,
  onClose,
}: {
  id: string;
  graphItem: Record<string, unknown> | null;
  onClose: () => void;
}) {
  const { handleFetchDynamoItem } = useApp();
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [data, setData]         = useState<Record<string, unknown> | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await handleFetchDynamoItem(id);
        if (cancelled) return;
        if (!result.success) setError(result.message ?? 'Fetch failed');
        else if (!result.data) setNotFound(true);
        else setData(result.data);
      } catch (err) {
        if (!cancelled) setError((err as Error).message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, handleFetchDynamoItem]);

  const onOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const dialogRef = useRef<HTMLDivElement>(null);

  /**
   * Escape closes, and Tab is confined to the dialog.
   *
   * Without the trap, tabbing walked straight out of the open dialog into the
   * page behind it, which a keyboard or screen-reader user cannot see is
   * covered. Focus is also moved into the dialog on open and returned to
   * whatever had it when the dialog closes.
   */
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();

    const focusableSelector = [
      'a[href]', 'button:not([disabled])', 'input:not([disabled])',
      'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const root = dialogRef.current;
      if (!root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(focusableSelector))
        .filter(el => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  const gItem = graphItem as ({ type?: string; data?: { fullLabel?: string; label?: string } }) | null;
  const isNode   = gItem?.type === 'node';
  const label    = isNode ? (gItem?.data?.fullLabel ?? '') : (gItem?.data?.label ?? 'Edge');
  const typeBadge = (
    <span className={`detail-type-badge ${isNode ? 'detail-type-node' : 'detail-type-edge'}`}>
      {isNode ? 'VERTEX' : 'EDGE'}
    </span>
  );

  return (
    <div className="dynamo-modal-overlay visible" onClick={onOverlayClick}>
      <div
        className="dynamo-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`DynamoDB record for ${label || id}`}
        tabIndex={-1}
      >
        <div className="dynamo-modal-header">
          <div className="dynamo-modal-title">
            {typeBadge}
            <span className="dynamo-modal-label">{label}</span>
            <span className="dynamo-modal-source">DynamoDB</span>
          </div>
          <button className="dynamo-modal-close" title="Close" onClick={onClose}>&times;</button>
        </div>

        <div className="dynamo-modal-id">
          <span className="detail-key">ID</span>
          <span className="detail-value">{id}</span>
        </div>

        <div className="dynamo-modal-body">
          {loading && (
            <div className="dynamo-modal-loading">
              <span className="loading-spinner" />
              Fetching from DynamoDB...
            </div>
          )}
          {error && (
            <div className="dynamo-modal-error">
              <strong>❌ Error</strong>
              <p>{error}</p>
            </div>
          )}
          {notFound && (
            <div className="dynamo-modal-empty">
              <strong>No record found</strong>
              <p>No item with id <code>{id}</code> was found.</p>
            </div>
          )}
          {data && (
            <div className="dynamo-modal-attrs">
              {Object.keys(data).sort().map(key => (
                <div key={key} className="dynamo-attr-row">
                  <div className="dynamo-attr-key">{key}</div>
                  <div className="dynamo-attr-value"><DynamoValue value={data[key]} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
