import { build } from 'esbuild';

await build({
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  // the extension host of the engines.vscode floor (1.97) runs Node 20
  target: 'node20',
  external: ['vscode'],
  sourcemap: true,
  minify: process.argv.includes('--production'),
});
