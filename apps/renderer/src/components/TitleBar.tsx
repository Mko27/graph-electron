/**
 * TitleBar — draggable strip rendered only on Windows.
 *
 * On Windows the BrowserWindow hides the OS caption bar and uses a
 * titleBarOverlay painted in the app's own chrome colour (see mainWindow.ts), so
 * the native minimise/maximise/close buttons sit directly on top of the page.
 * This strip fills that band with the same colour, provides the drag region the
 * hidden caption used to give us, and reserves space so the caption buttons
 * never overlap the tab bar.
 */

export function TitleBar() {
  return (
    <div id="titleBar">
      <div className="titlebar-drag">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3"/>
          <circle cx="4" cy="6" r="2"/><circle cx="20" cy="6" r="2"/>
          <circle cx="4" cy="18" r="2"/><circle cx="20" cy="18" r="2"/>
          <line x1="6" y1="6" x2="9.5" y2="10.5"/><line x1="18" y1="6" x2="14.5" y2="10.5"/>
          <line x1="6" y1="18" x2="9.5" y2="13.5"/><line x1="18" y1="18" x2="14.5" y2="13.5"/>
        </svg>
        <span>Graph Client</span>
      </div>
    </div>
  );
}
