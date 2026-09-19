import * as path from 'node:path';
import type * as vscode from 'vscode';
import { convert } from '../core/convert';
import type { ConvertOptions, ConvertResult } from '../core/types';

/** What the worker answers with; `ok: false` carries the reason conversion failed. */
type WorkerAnswer = { ok: true; result: ConvertResult } | { ok: false; message: string };

const TOO_LARGE = 'the clipboard content is too large to convert';
const STOPPED = 'the conversion worker stopped unexpectedly';

/** Node reports the memory ceiling as an `error` event, and only then exits. */
const isOutOfMemory = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ERR_WORKER_OUT_OF_MEMORY';

/**
 * Converts off the extension host, so VS Code stays responsive, cancelling the paste
 * ends the work, and a pathological clipboard hits the worker's memory ceiling instead
 * of exhausting the host. Resolves undefined when the paste was cancelled.
 */
export async function convertInBackground(
  html: string,
  options: ConvertOptions,
  token: vscode.CancellationToken,
): Promise<ConvertResult | undefined> {
  let threads: typeof import('node:worker_threads');
  try {
    threads = await import('node:worker_threads');
  } catch {
    return convert(html, options); // a host without worker threads, such as the web
  }

  // esbuild writes the worker next to the extension bundle
  const worker = new threads.Worker(path.join(__dirname, 'convertWorker.js'), {
    resourceLimits: { maxOldGenerationSizeMb: 512 },
  });
  let cancellation: vscode.Disposable | undefined;
  try {
    // the first settling wins: what follows it, such as the exit of a terminated worker, is ignored
    return await new Promise<ConvertResult | undefined>((resolve, reject) => {
      cancellation = token.onCancellationRequested(() => {
        void worker.terminate();
        resolve(undefined);
      });
      worker.on('message', (answer: WorkerAnswer) => {
        if (answer.ok) resolve(answer.result);
        else reject(new Error(answer.message));
      });
      worker.on('error', (error) => reject(isOutOfMemory(error) ? new Error(TOO_LARGE) : error));
      // reached only when the worker stopped without answering: a cancelled paste has
      // already resolved by now, and so has a successful one
      worker.on('exit', () => reject(new Error(STOPPED)));
      worker.postMessage({ html, options });
    });
  } finally {
    cancellation?.dispose();
    void worker.terminate();
  }
}
