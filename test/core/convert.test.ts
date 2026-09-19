import { describe, expect, it } from 'vitest';
import { convert } from '../../src/core/convert';
import { PNG_BASE64 } from './png';

const save = { imageDestination: 'assets', canSaveImages: true };
const png = `data:image/png;base64,${PNG_BASE64}`;

describe('convert: embedded images', () => {
  it('links an embedded image, returns its bytes once, and keeps alt text', async () => {
    const result = await convert(
      `<p>a <img alt="pic" src="${png}"> b <img src="${png}"></p>`,
      save,
    );
    expect(result.markdown).toBe(
      'a ![pic](assets/image-c414cd0e.png) b ![](assets/image-c414cd0e.png)',
    );
    expect(result.images.map((image) => [image.fileName, image.bytes.length])).toEqual([
      ['image-c414cd0e.png', 70],
    ]);
    expect(result.dropped).toEqual([]);
  });

  it('saves a percent-encoded SVG', async () => {
    const result = await convert('<img alt="s" src="data:image/svg+xml;utf8,%3Csvg%2F%3E">', save);
    expect(result.images.map((image) => image.fileName)).toEqual([
      expect.stringMatching(/^image-[0-9a-f]{8}\.svg$/),
    ]);
  });

  it('uses the destination in the link', async () => {
    const result = await convert(`<img src="${png}">`, {
      imageDestination: '..\\my images\\',
      canSaveImages: true,
    });
    expect(result.markdown).toBe('![](../my%20images/image-c414cd0e.png)');
  });

  it('drops images it cannot handle and says why, keeping the rest', async () => {
    const result = await convert(
      `<p>x<img src="data:image/bmp;base64,AAAA"><img src="data:image/png;base64,@@@"><img src="file:///C:/t/a.png"><img src="blob:https://x/1"><img src="cid:1"><img src="rel/a.png"></p>`,
      save,
    );
    expect(result.markdown).toBe('x');
    expect(result.images).toEqual([]);
    expect(result.dropped.map((d) => d.reason)).toEqual([
      'unsupported-type',
      'undecodable',
      'unsupported-source',
      'unsupported-source',
      'unsupported-source',
      'unsupported-source',
    ]);
  });

  it('drops embedded images when they cannot be saved (untitled document)', async () => {
    const result = await convert(`<p>x<img src="${png}"></p>`, {
      imageDestination: 'assets',
      canSaveImages: false,
    });
    expect(result.markdown).toBe('x');
    expect(result.dropped).toEqual([{ source: png.slice(0, 40), reason: 'cannot-save' }]);
  });

  it('never drops a remote image, even when images cannot be saved', async () => {
    const result = await convert('<img alt="x" src="https://e.com/a.png">', {
      imageDestination: 'assets',
      canSaveImages: false,
    });
    expect(result.markdown).toBe('![x](https://e.com/a.png)');
  });
});

describe('convert: lists', () => {
  it('keeps an item with two paragraphs loose', async () => {
    const result = await convert('<ul><li><p>a</p><p>b</p></li><li>c</li></ul>', save);
    expect(result.markdown).toBe('- a\n\n  b\n\n- c');
  });
});
