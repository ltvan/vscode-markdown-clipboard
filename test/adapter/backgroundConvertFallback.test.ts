import type * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import { convertInBackground } from '../../src/vscode/backgroundConvert';

// a host without worker threads, such as the web
vi.mock('node:worker_threads', () => {
  throw new Error('Cannot find module node:worker_threads');
});

const token = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => undefined }),
} as unknown as vscode.CancellationToken;

describe('convertInBackground without worker threads', () => {
  it('converts in process instead of spawning a worker', async () => {
    const result = await convertInBackground(
      '<p>a <b>b</b></p>',
      { imageDestination: 'assets', canSaveImages: true },
      token,
    );
    expect(result?.markdown).toBe('a **b**');
  });
});
