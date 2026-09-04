/**
 * CollapsibleSection — one accordion block in the sidebar.
 *
 * Open/closed state lives in AppContext keyed by `id`, so it is persisted with
 * the workspace and a section the user closed stays closed across launches. Ids
 * that have never been toggled fall back to `defaultOpen`.
 *
 * The body stays mounted while collapsed — half-filled forms survive a collapse
 * — and is hidden with `visibility: hidden` rather than `display: none`, which
 * both animates and keeps the hidden controls out of the tab order.
 *
 * Header actions sit next to the toggle rather than inside it: a button cannot
 * be nested in a button, and clicking "add" should not also collapse the panel.
 */

import type { ReactNode } from 'react';
import { useApp } from '../state/AppContext';

export function CollapsibleSection({
  id,
  title,
  icon,
  summary,
  actions,
  tone = 'muted',
  nested = false,
  defaultOpen = true,
  children,
}: {
  /** Stable persistence key — changing it resets the section to its default. */
  id: string;
  title: string;
  icon: ReactNode;
  /** Compact state shown in the header, readable while collapsed. */
  summary?: ReactNode;
  /** Controls rendered to the right of the header (add, refresh…). */
  actions?: ReactNode;
  /** `primary` for the headline configuration sections, `muted` for helpers. */
  tone?: 'primary' | 'muted';
  /** A section inside another section's body — quieter, tighter, boxed. */
  nested?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const { sidebarSections, setSidebarSection } = useApp();
  const open = sidebarSections[id] ?? defaultOpen;
  const bodyId = `sb-body-${id}`;

  return (
    <section className={`sb-section tone-${tone} ${nested ? 'is-nested' : ''} ${open ? 'is-open' : 'is-closed'}`}>
      <div className="sb-section-head">
        <button
          type="button"
          className="sb-section-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          title={open ? `Collapse ${title}` : `Expand ${title}`}
          onClick={() => setSidebarSection(id, !open)}
        >
          <svg className="sb-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 6 15 12 9 18" />
          </svg>
          <span className="sb-section-icon">{icon}</span>
          <span className="sb-section-title">{title}</span>
          {summary && <span className="sb-section-summary">{summary}</span>}
        </button>
        {actions && <div className="sb-section-actions">{actions}</div>}
      </div>
      <div className="sb-section-body" id={bodyId} aria-hidden={!open}>
        {/* clip absorbs the collapse; padding lives one level deeper so a
            closed section leaves no dead space behind its header. */}
        <div className="sb-section-body-clip">
          <div className="sb-section-body-inner">{children}</div>
        </div>
      </div>
    </section>
  );
}
