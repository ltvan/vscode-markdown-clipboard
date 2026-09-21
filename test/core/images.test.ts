import type { Root } from 'hast';
import { describe, expect, it } from 'vitest';
import { type ImageCollector, rewriteImages } from '../../src/core/html/images';
import { decodeDataUri, extensionForMime, imageFileName } from '../../src/core/images';
import { PNG_BASE64 } from './png';

describe('decodeDataUri', () => {
  it('decodes base64', () => {
    const decoded = decodeDataUri(`data:image/png;base64,${PNG_BASE64}`);
    expect(decoded?.mime).toBe('image/png');
    expect(decoded?.bytes.length).toBe(70);
  });
  it('decodes percent-encoded data', () => {
    const decoded = decodeDataUri('data:image/svg+xml;utf8,%3Csvg%2F%3E');
    expect(decoded?.mime).toBe('image/svg+xml');
    expect(new TextDecoder().decode(decoded?.bytes)).toBe('<svg/>');
  });
  it('decodes a percent-encoded payload byte for byte, not as UTF-8 text', () => {
    const bytes = decodeDataUri(`data:image/png;base64,${PNG_BASE64}`)!.bytes;
    const escaped = Array.from(
      bytes,
      (byte) => `%${byte.toString(16).padStart(2, '0').toUpperCase()}`,
    ).join('');
    const decoded = decodeDataUri(`data:image/png,${escaped}`);
    expect(decoded?.bytes.length).toBe(70);
    expect([...(decoded?.bytes ?? [])]).toEqual([...bytes]);
  });
  it('decodes escapes above 0x7f', () => {
    expect([...(decodeDataUri('data:image/jpeg,%FF%D8%FF')?.bytes ?? [])]).toEqual([
      0xff, 0xd8, 0xff,
    ]);
  });
  it('lower-cases the MIME type and tolerates whitespace in base64', () => {
    expect(
      decodeDataUri(`data:IMAGE/PNG;base64,${PNG_BASE64.slice(0, 40)}\n${PNG_BASE64.slice(40)}`)
        ?.mime,
    ).toBe('image/png');
  });
  it.each(['data:image/png;base64,@@@', 'data:image/png;utf8,%E0%A4%A', 'nonsense'])(
    'returns undefined for undecodable %j',
    (src) => {
      expect(decodeDataUri(src)).toBeUndefined();
    },
  );
});

describe('extensionForMime', () => {
  it('maps the supported types', () => {
    expect(
      ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'].map(extensionForMime),
    ).toEqual(['png', 'jpg', 'gif', 'webp', 'svg']);
  });
  it('returns undefined for anything else', () => {
    expect(extensionForMime('image/bmp')).toBeUndefined();
  });
});

describe('imageFileName', () => {
  it('is the first 16 hex digits of the SHA-256 of the bytes', async () => {
    const bytes = decodeDataUri(`data:image/png;base64,${PNG_BASE64}`)!.bytes;
    expect(await imageFileName(bytes, 'png')).toBe('image-c414cd0e204de974.png');
  });
});

describe('rewriteImages', () => {
  const treeWith = (src: string): Root => ({
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [{ type: 'element', tagName: 'img', properties: { src }, children: [] }],
      },
    ],
  });

  it('drops an image whose name is taken by different bytes instead of linking those', async () => {
    const tree = treeWith(`data:image/png;base64,${PNG_BASE64}`);
    const taken = { fileName: 'image-c414cd0e204de974.png', bytes: new Uint8Array([1, 2, 3]) };
    const out: ImageCollector = { images: [taken], dropped: [] };
    await rewriteImages(tree, { imageDestination: 'assets', canSaveImages: true }, out);
    expect(out.images).toEqual([taken]);
    expect(out.dropped.map((image) => image.reason)).toEqual(['name-collision']);
  });
});
