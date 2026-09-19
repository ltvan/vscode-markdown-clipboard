const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

export function extensionForMime(mime: string): string | undefined {
  return EXTENSIONS[mime];
}

export function decodeDataUri(
  src: string,
): { mime: string; bytes: Uint8Array<ArrayBuffer> } | undefined {
  const match = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(src);
  if (!match) return undefined;
  const mime = (match[1] ?? '').toLowerCase();
  const parameters = match[2] ?? '';
  const payload = match[3] ?? '';
  try {
    if (!/;base64$/i.test(parameters)) {
      return { mime, bytes: new TextEncoder().encode(decodeURIComponent(payload)) };
    }
    const base64 = payload.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 === 1) return undefined;
    return { mime, bytes: Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)) };
  } catch {
    return undefined;
  }
}

export async function imageFileName(
  bytes: Uint8Array<ArrayBuffer>,
  extension: string,
): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hash = Array.from(digest.slice(0, 4), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  return `image-${hash}.${extension}`;
}
