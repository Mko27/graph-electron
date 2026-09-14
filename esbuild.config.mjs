import esbuild from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes('--watch');
// Production is the default for a packaged build; NODE_ENV=development (or
// --dev) opts back into the readable, source-mapped bundle for local work.
const isProduction =
  !isWatch && !process.argv.includes('--dev') && process.env.NODE_ENV !== 'development';

/**
 * The preload must be BUNDLED, not merely compiled.
 *
 * It runs in a sandboxed context where `require` is limited to electron and a
 * few Node builtins — a workspace package like @graph-client/shared cannot be
 * resolved there, and the failure takes down the whole bridge (window.
 * graphClient ends up undefined and the renderer dies on its first IPC call).
 * Bundling inlines those imports so nothing is resolved at runtime.
 *
 * @type {import('esbuild').BuildOptions}
 */
const preloadOptions = {
  entryPoints: ['apps/electron/src/windows/preload.ts'],
  bundle: true,
  outfile: 'apps/electron/dist/preload.js',
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  // Provided by the Electron runtime; must stay a require.
  external: ['electron'],
  alias: {
    '@graph-client/shared': path.join(__dirname, 'packages/shared/src/index.ts'),
  },
  minify: isProduction,
  sourcemap: false,
};

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ['apps/renderer/src/main.tsx'],
  bundle: true,
  outfile: 'apps/renderer/dist/bundle.js',
  format: 'iife',
  platform: 'browser',
  // Matches the Chromium in the bundled Electron (44.x).
  target: 'chrome138',
  jsx: 'automatic',
  loader: { '.jsx': 'jsx', '.js': 'js', '.tsx': 'tsx', '.ts': 'ts' },
  define: {
    // React ships separate dev/prod paths behind this flag; hardcoding
    // "development" kept every release on the slower one, with its extra
    // warnings and dev-only checks.
    'process.env.NODE_ENV': isProduction ? '"production"' : '"development"',
  },
  // Resolve @graph-client/shared source directly (no compile step needed)
  alias: {
    '@graph-client/shared': path.join(__dirname, 'packages/shared/src/index.ts'),
  },
  minify: isProduction,
  // Production keeps the map out of the shipped app entirely: it inlines the
  // full original renderer source, which electron-builder was then packaging.
  sourcemap: isProduction ? false : true,
};

if (isWatch) {
  const [rendererCtx, preloadCtx] = await Promise.all([
    esbuild.context(buildOptions),
    esbuild.context(preloadOptions),
  ]);
  await Promise.all([rendererCtx.watch(), preloadCtx.watch()]);
  console.log('[esbuild] Watching renderer + preload for changes…');
} else {
  await Promise.all([esbuild.build(buildOptions), esbuild.build(preloadOptions)]);
  const mode = isProduction ? 'production, minified' : 'development';
  console.log(`[esbuild] Bundle built (${mode}) → apps/renderer/dist/bundle.js`);
  console.log(`[esbuild] Preload bundled (${mode}) → apps/electron/dist/preload.js`);
}
