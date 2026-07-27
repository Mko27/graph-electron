import esbuild from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ['apps/renderer/src/main.tsx'],
  bundle: true,
  outfile: 'apps/renderer/dist/bundle.js',
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  jsx: 'automatic',
  loader: { '.jsx': 'jsx', '.js': 'js', '.tsx': 'tsx', '.ts': 'ts' },
  define: {
    'process.env.NODE_ENV': '"development"',
  },
  // Resolve @graph-client/shared source directly (no compile step needed)
  alias: {
    '@graph-client/shared': path.join(__dirname, 'packages/shared/src/index.ts'),
  },
  minify: false,
  sourcemap: true,
};

if (isWatch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('[esbuild] Watching for changes… (entry: apps/renderer/src/main.tsx)');
} else {
  await esbuild.build(buildOptions);
  console.log('[esbuild] Bundle built → apps/renderer/dist/bundle.js');
}
