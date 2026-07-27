/**
 * One-shot smoke test: launch app, screenshot key UI states, report.
 */
import { _electron as electron } from 'playwright-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(fileURLToPath(import.meta.url), '..');
const SHOTS   = '/tmp/neptune-shots';
fs.mkdirSync(SHOTS, { recursive: true });

const electronBin = path.join(APP_DIR,
  'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');

const shot = async (page, name) => {
  const f = path.join(SHOTS, name + '.png');
  await page.screenshot({ path: f, fullPage: false });
  console.log('  screenshot:', f);
  return f;
};

async function run() {
  console.log('\n=== Launching Neptune Graph Client ===');
  const app = await electron.launch({
    executablePath: electronBin,
    args: [APP_DIR],
    timeout: 30_000,
  });

  let page;
  try {
    await new Promise(r => setTimeout(r, 4_000));
    page = app.windows().find(w => !w.url().startsWith('devtools://'))
        ?? await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    console.log('\n[1] Initial state (should show empty app with sidebar)');
    await shot(page, '01-initial');

    // Check sidebar has connections panel
    const hasSidebar = await page.evaluate(() => !!document.querySelector('#sidebar'));
    console.log('  sidebar present:', hasSidebar);

    const hasConnPanel = await page.evaluate(() =>
      [...document.querySelectorAll('.section-title')]
        .some(el => el.textContent.includes('Connections'))
    );
    console.log('  connections panel present:', hasConnPanel);

    // Check query tabs bar is present
    const hasTabsBar = await page.evaluate(() => !!document.querySelector('.query-tabs-bar'));
    console.log('  query tabs bar present:', hasTabsBar);

    // Count initial tabs
    const tabCount = await page.evaluate(() =>
      document.querySelectorAll('.query-tab').length
    );
    console.log('  initial tab count:', tabCount);

    // Check query editor is present
    const hasEditor = await page.evaluate(() => !!document.querySelector('#queryEditor'));
    console.log('  query editor present:', hasEditor);

    // Check connection select dropdown
    const hasConnSelect = await page.evaluate(() => !!document.querySelector('.conn-select'));
    console.log('  connection dropdown in query panel:', hasConnSelect);

    console.log('\n[2] Add a second tab');
    await page.evaluate(() => {
      document.querySelector('.tab-add-btn')?.click();
    });
    await new Promise(r => setTimeout(r, 300));

    const tabCount2 = await page.evaluate(() =>
      document.querySelectorAll('.query-tab').length
    );
    console.log('  tab count after adding:', tabCount2);
    await shot(page, '02-two-tabs');

    console.log('\n[3] Open add-connection form');
    await page.evaluate(() => {
      // Click the + button in the Connections section title
      const btns = [...document.querySelectorAll('.sidebar-section .btn-icon')];
      const addBtn = btns.find(b => b.title?.toLowerCase().includes('add'));
      if (addBtn) addBtn.click();
    });
    await new Promise(r => setTimeout(r, 400));

    const hasForm = await page.evaluate(() => !!document.querySelector('.add-conn-form'));
    console.log('  add-connection form visible:', hasForm);
    await shot(page, '03-add-conn-form');

    console.log('\n[4] Fill connection form (won\'t actually connect without Neptune)');
    await page.evaluate(() => {
      const inputs = document.querySelectorAll('.add-conn-form input[type="text"]');
      // First input = name, second = endpoint
      if (inputs[0]) { inputs[0].focus(); inputs[0].value = 'Test DB'; inputs[0].dispatchEvent(new Event('input', { bubbles: true })); }
      if (inputs[1]) { inputs[1].focus(); inputs[1].value = 'test.cluster.us-east-1.neptune.amazonaws.com'; inputs[1].dispatchEvent(new Event('input', { bubbles: true })); }
    });
    await new Promise(r => setTimeout(r, 300));
    await shot(page, '04-form-filled');

    console.log('\n[5] Check query editor default content');
    const editorVal = await page.evaluate(() =>
      document.querySelector('#queryEditor')?.value
    );
    console.log('  editor value:', editorVal);

    console.log('\n[6] Switch between tabs, check independence');
    // Click first tab
    await page.evaluate(() => {
      document.querySelectorAll('.query-tab')[0]?.click();
    });
    await new Promise(r => setTimeout(r, 200));
    const tab1Query = await page.evaluate(() =>
      document.querySelector('#queryEditor')?.value
    );

    // Click second tab
    await page.evaluate(() => {
      document.querySelectorAll('.query-tab')[1]?.click();
    });
    await new Promise(r => setTimeout(r, 200));
    const tab2Query = await page.evaluate(() =>
      document.querySelector('#queryEditor')?.value
    );
    console.log('  tab 1 query:', JSON.stringify(tab1Query));
    console.log('  tab 2 query:', JSON.stringify(tab2Query));

    // Type in tab 2
    await page.evaluate(() => {
      const ta = document.querySelector('#queryEditor');
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (nativeSetter) { nativeSetter.call(ta, 'g.E().limit(5)'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    await new Promise(r => setTimeout(r, 200));

    // Switch back to tab 1
    await page.evaluate(() => {
      document.querySelectorAll('.query-tab')[0]?.click();
    });
    await new Promise(r => setTimeout(r, 200));
    const tab1AfterSwitch = await page.evaluate(() =>
      document.querySelector('#queryEditor')?.value
    );
    console.log('  tab 1 query after typing in tab 2:', JSON.stringify(tab1AfterSwitch));
    await shot(page, '05-tabs-independent');

    console.log('\n[7] Check Quick Queries insert');
    const firstQuickBtn = await page.evaluate(() => {
      const btns = document.querySelectorAll('.quick-query-btn');
      if (btns[0]) { btns[0].click(); return btns[0].textContent; }
      return null;
    });
    await new Promise(r => setTimeout(r, 200));
    const afterQuickQuery = await page.evaluate(() =>
      document.querySelector('#queryEditor')?.value
    );
    console.log('  clicked quick query:', JSON.stringify(firstQuickBtn));
    console.log('  editor after quick query click:', JSON.stringify(afterQuickQuery));

    console.log('\n[8] Final state');
    await shot(page, '06-final');

    // Summary
    console.log('\n=== Results ===');
    const passed = hasSidebar && hasConnPanel && hasTabsBar && hasEditor && hasConnSelect && (tabCount2 === 2);
    console.log('  Sidebar:                  ', hasSidebar     ? '✓' : '✗');
    console.log('  Connections panel:        ', hasConnPanel   ? '✓' : '✗');
    console.log('  Query tabs bar:           ', hasTabsBar     ? '✓' : '✗');
    console.log('  Query editor:             ', hasEditor      ? '✓' : '✗');
    console.log('  Connection dropdown:      ', hasConnSelect  ? '✓' : '✗');
    console.log('  Tab add works (→2 tabs):  ', tabCount2===2  ? '✓' : '✗');
    console.log('  Tab independence:         ', tab1AfterSwitch === (tab1Query || 'g.V().limit(10)') ? '✓' : '✗');
    console.log('  Quick query insert:       ', (afterQuickQuery && afterQuickQuery !== tab1Query) ? '✓' : '✗');
    console.log('\n  Screenshots in:', SHOTS);
    console.log('  Overall:', passed ? 'PASS' : 'FAIL');

  } finally {
    await app.close().catch(() => {});
  }
}

run().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
