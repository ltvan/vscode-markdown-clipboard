import { build } from 'esbuild';

const production = process.argv.includes('--production');

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
  // a production bundle ships without its .map file, so a sourceMappingURL would point at
  // nothing; keep source maps for development, where dist/*.js.map sits right next to it
  sourcemap: !production,
  minify: production,
});
