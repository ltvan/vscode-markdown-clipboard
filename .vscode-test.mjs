import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@vscode/test-cli';

const workspace = mkdtempSync(join(tmpdir(), 'mdclip-ws-'));
// a short user-data path: VS Code's IPC socket path has a ~100 character limit
const userData = mkdtempSync(join(tmpdir(), 'mdclip-ud-'));

export default defineConfig({
  files: 'out/e2e/**/*.test.js',
  workspaceFolder: workspace,
  launchArgs: ['--disable-extensions', '--disable-workspace-trust', `--user-data-dir=${userData}`],
  mocha: { timeout: 30_000 },
});
