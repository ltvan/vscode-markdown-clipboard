import { describe, expect, it } from 'vitest';
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
  it('is the first 8 hex digits of the SHA-256 of the bytes', async () => {
    const bytes = decodeDataUri(`data:image/png;base64,${PNG_BASE64}`)!.bytes;
    expect(await imageFileName(bytes, 'png')).toBe('image-c414cd0e.png');
  });
});
