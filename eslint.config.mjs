import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

const impure = [
  'vscode',
  'fs',
  'fs/promises',
  'http',
  'https',
  'net',
  'http2',
  'tls',
  'dgram',
  'dns',
  'child_process',
  'worker_threads',
  'cluster',
].flatMap((name) => [name, `node:${name}`]);

export default tseslint.config(
  { ignores: ['dist/', 'out/', '.vscode-test/', 'test/core/fixtures/'] },
  ...tseslint.configs.recommended,
  {
    // provider methods keep their full signature; unused parameters are prefixed with _
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: impure.map((name) => ({
            name,
            message: 'src/core must stay pure: no VS Code API, no I/O.',
          })),
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'src/core must never touch the network.' },
        { name: 'XMLHttpRequest', message: 'src/core must never touch the network.' },
        { name: 'WebSocket', message: 'src/core must never touch the network.' },
        { name: 'EventSource', message: 'src/core must never touch the network.' },
        { name: 'navigator', message: 'src/core must never touch the network.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'globalThis',
          property: 'fetch',
          message: 'src/core must never touch the network.',
        },
      ],
    },
  },
  prettier,
);
