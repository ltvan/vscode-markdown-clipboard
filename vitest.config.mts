import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/core/**/*.test.ts', 'test/adapter/**/*.test.ts'] },
  resolve: {
    alias: { vscode: fileURLToPath(new URL('./test/adapter/vscodeStub.ts', import.meta.url)) },
  },
});
