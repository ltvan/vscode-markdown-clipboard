import { build } from 'esbuild';

await build({
  // the worker must land next to the extension bundle: convertInBackground spawns dist/convertWorker.js
  entryPoints: { extension: 'src/extension.ts', convertWorker: 'src/vscode/convertWorker.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  // the extension host of the engines.vscode floor (1.97) runs Node 20
  target: 'node20',
  external: ['vscode'],
  sourcemap: true,
  minify: process.argv.includes('--production'),
});
