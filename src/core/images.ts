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

/**
 * Percent escapes stand for single bytes, not for characters: decoding them as text
 * would mangle or reject every byte above 0x7f of a percent-encoded raster image.
 */
function decodeEscapes(payload: string): Uint8Array<ArrayBuffer> | undefined {
  const bytes = new Uint8Array(payload.length);
  let length = 0;
  for (let index = 0; index < payload.length; index++) {
    if (payload.charAt(index) === '%') {
      const hex = payload.slice(index + 1, index + 3);
      if (!/^[0-9a-f]{2}$/i.test(hex)) return undefined;
      bytes[length++] = Number.parseInt(hex, 16);
      index += 2;
    } else {
      bytes[length++] = payload.charCodeAt(index) & 0xff;
    }
  }
  return bytes.slice(0, length);
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
      const bytes = decodeEscapes(payload);
      return bytes ? { mime, bytes } : undefined;
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
  const hash = Array.from(digest.slice(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  return `image-${hash}.${extension}`;
}
