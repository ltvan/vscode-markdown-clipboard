import * as path from 'node:path';
import type * as vscode from 'vscode';
import { convert } from '../core/convert';
import type { ConvertOptions, ConvertResult } from '../core/types';

/** What the worker answers with; `ok: false` carries the reason conversion failed. */
type WorkerAnswer = { ok: true; result: ConvertResult } | { ok: false; message: string };

const TOO_LARGE = 'the clipboard content is too large to convert';

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
  let Worker;
  try {
    ({ Worker } = await import('node:worker_threads'));
  } catch {
    return convert(html, options); // a host without worker threads, such as the web
  }

  // esbuild writes the worker next to the extension bundle
  const worker = new Worker(path.join(__dirname, 'convertWorker.js'), {
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
      worker.on('error', reject);
      // the worker died before answering, for instance on its memory ceiling
      worker.on('exit', (code) => {
        if (code === 0) resolve(undefined);
        else reject(new Error(TOO_LARGE));
      });
      worker.postMessage({ html, options });
    });
  } finally {
    cancellation?.dispose();
    void worker.terminate();
  }
}
