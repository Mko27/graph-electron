/**
 * Toasts — surfaces every notification (errors above all) as a dismissible card.
 *
 * Errors used to be visible only as one truncated line in the status bar. These
 * cards show the full message, keep it selectable, offer a one-click copy, and
 * — for connection failures — carry the action that fixes them. Errors and
 * warnings stay until dismissed; info/success fade on their own.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../state/AppContext';
import { copyText } from '../utils/clipboard';
import type { Notification, NotificationType } from '../state/AppContext';

const AUTO_DISMISS_MS: Partial<Record<NotificationType, number>> = {
  info: 4_000,
  success: 4_000,
};

const ICONS: Record<NotificationType, string> = {
  error: '✕',
  warning: '!',
  info: 'i',
  success: '✓',
};

function Toast({ note, onDismiss }: { note: Notification; onDismiss: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  // onDismiss is a fresh closure on every parent render; going through a ref
  // keeps the countdown from restarting each time the app re-renders.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  const autoMs = AUTO_DISMISS_MS[note.type];
  useEffect(() => {
    if (!autoMs) return;
    const timer = setTimeout(() => dismissRef.current(), autoMs);
    return () => clearTimeout(timer);
  }, [autoMs]);

  const onCopy = useCallback(async () => {
    const ok = await copyText(note.detail ? `${note.title}\n\n${note.detail}` : note.title);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    }
  }, [note.title, note.detail]);

  const hasDetail = Boolean(note.detail && note.detail.trim());

  return (
    <div className={`toast toast-${note.type}`} role={note.type === 'error' ? 'alert' : 'status'}>
      <span className={`toast-icon toast-icon-${note.type}`}>{ICONS[note.type]}</span>

      <div className="toast-body">
        <div className="toast-title">{note.title}</div>

        {hasDetail && (
          <>
            <pre className={`toast-detail ${expanded ? 'expanded' : ''}`}>{note.detail}</pre>
            {(note.detail as string).length > 160 && (
              <button className="toast-link-btn" onClick={() => setExpanded(v => !v)}>
                {expanded ? 'Show less' : 'Show full message'}
              </button>
            )}
          </>
        )}

        <div className="toast-actions">
          {note.action && (
            <button
              className="btn-sm btn-primary-sm"
              onClick={() => { note.action!.run(); onDismiss(); }}
            >
              {note.action.label}
            </button>
          )}
          <button className="toast-link-btn" onClick={() => { void onCopy(); }}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <span className="toast-time">{note.timestamp}</span>
        </div>
      </div>

      <button className="toast-close" title="Dismiss" onClick={onDismiss}>&times;</button>
    </div>
  );
}

export function Toasts() {
  const { notifications, dismissNotification, clearNotifications } = useApp();

  if (notifications.length === 0) return null;

  return (
    <div className="toast-stack">
      {notifications.length > 2 && (
        <button className="toast-clear-all" onClick={clearNotifications}>
          Dismiss all ({notifications.length})
        </button>
      )}
      {notifications.map(note => (
        <Toast key={note.id} note={note} onDismiss={() => dismissNotification(note.id)} />
      ))}
    </div>
  );
}
