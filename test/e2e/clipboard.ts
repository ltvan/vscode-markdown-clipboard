import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ClipboardContent {
  html?: string;
  text?: string;
  png?: Buffer;
}

const hex = (data: Buffer): string => data.toString('hex').toUpperCase();

function seedMac(content: ClipboardContent): void {
  const flavors: string[] = [];
  if (content.html !== undefined)
    flavors.push(`«class HTML»:«data HTML${hex(Buffer.from(content.html))}»`);
  if (content.text !== undefined) flavors.push(`string:${JSON.stringify(content.text)}`);
  if (content.png !== undefined) flavors.push(`«class PNGf»:«data PNGf${hex(content.png)}»`);
  execFileSync('osascript', ['-e', `set the clipboard to {${flavors.join(', ')}}`]);
}

function seedWindows(content: ClipboardContent): void {
  const spec = join(mkdtempSync(join(tmpdir(), 'mdclip-seed-')), 'spec.json');
  writeFileSync(
    spec,
    JSON.stringify({
      html: content.html,
      text: content.text,
      pngBase64: content.png?.toString('base64'),
    }),
  );
  // out/e2e/clipboard.js → test/e2e/seed-windows.ps1
  const script = join(__dirname, '..', '..', 'test', 'e2e', 'seed-windows.ps1');
  execFileSync('powershell.exe', [
    '-NoProfile',
    '-STA',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    script,
    '-SpecPath',
    spec,
  ]);
}

function seedLinux(content: ClipboardContent): void {
  // xclip can offer only one target per selection, so CopyQ (multi-format) owns the clipboard
  const parts: string[] = [];
  if (content.html !== undefined) parts.push(`'text/html', ${JSON.stringify(content.html)}`);
  if (content.text !== undefined) parts.push(`'text/plain', ${JSON.stringify(content.text)}`);
  if (content.png !== undefined)
    parts.push(`'image/png', fromBase64(${JSON.stringify(content.png.toString('base64'))})`);
  execFileSync('copyq', ['eval', `copy(${parts.join(', ')})`]);
}

/** Puts exactly the given flavors on the real system clipboard. Test-only. */
export function seedClipboard(content: ClipboardContent): void {
  switch (process.platform) {
    case 'darwin':
      return seedMac(content);
    case 'win32':
      return seedWindows(content);
    case 'linux':
      return seedLinux(content);
    default:
      throw new Error(`clipboard seeding is not implemented on ${process.platform}`);
  }
}
