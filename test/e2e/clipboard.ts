import { execFileSync } from 'node:child_process';

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

/** Puts exactly the given flavors on the real system clipboard. Test-only. */
export function seedClipboard(content: ClipboardContent): void {
  switch (process.platform) {
    case 'darwin':
      return seedMac(content);
    default:
      throw new Error(`clipboard seeding is not implemented on ${process.platform}`);
  }
}
