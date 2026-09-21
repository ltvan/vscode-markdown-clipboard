import { EventEmitter } from 'node:events';
import type * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { convertInBackground } from '../../src/vscode/backgroundConvert';
import type { ConvertResult } from '../../src/core/types';

/** Stands in for the real worker so the wrapper can be driven event by event. */
class FakeWorker extends EventEmitter {
  static last: FakeWorker | undefined;
  readonly posted: unknown[] = [];
  terminated = 0;
  constructor(
    readonly file: string,
    readonly options: { resourceLimits?: { maxOldGenerationSizeMb?: number } },
  ) {
    super();
    FakeWorker.last = this;
  }
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  async terminate(): Promise<number> {
    this.terminated++;
    return 0;
  }
}

vi.mock('node:worker_threads', () => ({ Worker: FakeWorker }));

const options = { imageDestination: 'assets', canSaveImages: true };
const result: ConvertResult = { markdown: 'x', images: [], dropped: [] };

function cancellation(): { token: vscode.CancellationToken; cancel: () => void } {
  const listeners: (() => void)[] = [];
  return {
    token: {
      isCancellationRequested: false,
      onCancellationRequested: (listener: () => void) => {
        listeners.push(listener);
        return { dispose: () => undefined };
      },
    } as unknown as vscode.CancellationToken,
    cancel: () => listeners.forEach((listener) => listener()),
  };
}

/** The worker module is loaded lazily, so give the spawn a turn before driving it. */
async function start(token: vscode.CancellationToken): Promise<{
  pending: Promise<ConvertResult | undefined>;
  worker: FakeWorker;
}> {
  const pending = convertInBackground('<p>x</p>', options, token);
  await vi.waitFor(() => expect(FakeWorker.last).toBeDefined());
  return { pending, worker: FakeWorker.last! };
}

describe('convertInBackground', () => {
  beforeEach(() => {
    FakeWorker.last = undefined;
  });

  it('spawns a worker next to the bundle with a memory ceiling and hands it the work', async () => {
    const { pending, worker } = await start(cancellation().token);
    expect(worker.file.replace(/\\/g, '/')).toMatch(/\/convertWorker\.js$/);
    expect(worker.options.resourceLimits?.maxOldGenerationSizeMb).toBe(512);
    expect(worker.posted).toEqual([{ html: '<p>x</p>', options }]);
    worker.emit('message', { ok: true, result });
    await expect(pending).resolves.toEqual(result);
    expect(worker.terminated).toBeGreaterThan(0);
  });

  it('rejects with the reason the worker reports', async () => {
    const { pending, worker } = await start(cancellation().token);
    worker.emit('message', { ok: false, message: 'boom' });
    await expect(pending).rejects.toThrow('boom');
  });

  it('rejects when the worker itself fails', async () => {
    const { pending, worker } = await start(cancellation().token);
    worker.emit('error', new Error('worker died'));
    await expect(pending).rejects.toThrow('worker died');
  });

  it('blames the payload only when the worker ran out of memory', async () => {
    const { pending, worker } = await start(cancellation().token);
    const outOfMemory = Object.assign(new Error('JS heap out of memory'), {
      code: 'ERR_WORKER_OUT_OF_MEMORY',
    });
    worker.emit('error', outOfMemory);
    worker.emit('exit', 1);
    await expect(pending).rejects.toThrow('the clipboard content is too large to convert');
  });

  it.each([
    ['a clean exit', 0],
    ['any other non-zero exit', 7],
  ])('reports %s without a result', async (_name, code) => {
    const { pending, worker } = await start(cancellation().token);
    worker.emit('exit', code);
    await expect(pending).rejects.toThrow('the conversion worker stopped unexpectedly');
  });

  it('terminates the worker and yields nothing when the paste is cancelled', async () => {
    const { token, cancel } = cancellation();
    const { pending, worker } = await start(token);
    cancel();
    await expect(pending).resolves.toBeUndefined();
    expect(worker.terminated).toBeGreaterThan(0);
  });
});
