/**
 * useQueryReplace — replace the editor's contents, asking first when that would
 * throw away work.
 *
 * Schema labels, history entries and quick queries all overwrite the editor
 * outright. Because the textarea is controlled, the browser's own Ctrl+Z
 * cannot bring the old text back either, so one curious click could lose a
 * long query with no way to recover it.
 *
 * Replacing is silent when the editor is empty or holds text the user did not
 * type (the previous insert). Otherwise it confirms, and either way the
 * outgoing text is kept so it can be restored.
 */

import { useCallback, useRef, useState } from 'react';
import { useApp } from '../state/AppContext';

/** Below this, losing the text is not worth interrupting for. */
const TRIVIAL_LENGTH = 12;

export function useQueryReplace() {
  const { activeTab, activeTabId, setTabQuery } = useApp();
  const currentQuery = activeTab?.query ?? '';

  /** Text this hook last wrote, so we know it was not hand-typed. */
  const lastInsertedRef = useRef<string | null>(null);
  const [undoBuffer, setUndoBuffer] = useState<string | null>(null);

  const replaceQuery = useCallback((next: string): boolean => {
    const existing = currentQuery;
    const trimmed = existing.trim();

    const isDisposable =
      trimmed.length === 0 ||
      trimmed.length < TRIVIAL_LENGTH ||
      existing === lastInsertedRef.current;

    if (!isDisposable && trimmed !== next.trim()) {
      const ok = window.confirm(
        'Replace the query in the editor?\n\n' +
        'The current query will be replaced. You can put it back with the ' +
        '"Restore previous query" button underneath the editor.',
      );
      if (!ok) return false;
    }

    setUndoBuffer(existing.length > 0 ? existing : null);
    lastInsertedRef.current = next;
    setTabQuery(activeTabId, next);
    return true;
  }, [currentQuery, activeTabId, setTabQuery]);

  /** Put back whatever the last replace overwrote. */
  const restorePrevious = useCallback(() => {
    if (undoBuffer === null) return;
    lastInsertedRef.current = null;
    setTabQuery(activeTabId, undoBuffer);
    setUndoBuffer(null);
  }, [undoBuffer, activeTabId, setTabQuery]);

  return { replaceQuery, restorePrevious, canRestore: undoBuffer !== null };
}
