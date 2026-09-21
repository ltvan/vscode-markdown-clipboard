import { parentPort } from 'node:worker_threads';
import { convert } from '../core/convert';
import type { ConvertOptions } from '../core/types';

/** The worker entry of `convertInBackground`: it must never import `vscode`. */
parentPort?.on('message', async ({ html, options }: { html: string; options: ConvertOptions }) => {
  try {
    const result = await convert(html, options);
    const buffers = [...new Set(result.images.map((image) => image.bytes.buffer))];
    parentPort?.postMessage({ ok: true, result }, buffers);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    parentPort?.postMessage({ ok: false, message });
  }
});
