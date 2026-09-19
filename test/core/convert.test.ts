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
      'a ![pic](assets/image-c414cd0e204de974.png) b ![](assets/image-c414cd0e204de974.png)',
    );
    expect(result.images.map((image) => [image.fileName, image.bytes.length])).toEqual([
      ['image-c414cd0e204de974.png', 70],
    ]);
    expect(result.dropped).toEqual([]);
  });

  it('saves a percent-encoded SVG', async () => {
    const result = await convert('<img alt="s" src="data:image/svg+xml;utf8,%3Csvg%2F%3E">', save);
    expect(result.images.map((image) => image.fileName)).toEqual([
      expect.stringMatching(/^image-[0-9a-f]{16}\.svg$/),
    ]);
  });

  it('drops an SVG with a script or an external reference, keeping the rest', async () => {
    const unclean = 'data:image/svg+xml;utf8,%3Csvg%20onload%3D%22x%22%2F%3E';
    const result = await convert(`<p>x<img src="${unclean}"></p>`, save);
    expect(result.markdown).toBe('x');
    expect(result.images).toEqual([]);
    expect(result.dropped.map((image) => image.reason)).toEqual(['unsafe-svg']);
  });

  it('uses the destination in the link', async () => {
    const result = await convert(`<img src="${png}">`, {
      imageDestination: '..\\my images\\',
      canSaveImages: true,
    });
    expect(result.markdown).toBe('![](../my%20images/image-c414cd0e204de974.png)');
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

  it('drops a namespaced script with its content, keeping the surrounding text', async () => {
    const result = await convert('<p>a<v:script>alert(1)</v:script>b</p>', save);
    expect(result.markdown).toBe('ab');
  });

  it('keeps an item holding only a nested list tight', async () => {
    const result = await convert('<ul><li><ul><li>x</li><li>y</li></ul></li><li>z</li></ul>', save);
    expect(result.markdown).toBe('- - x\n  - y\n- z');
    expect(result.markdown).not.toContain('\n\n');
  });
});

describe('convert: unsafe link and image targets', () => {
  it.each([
    ['an iframe', '<iframe src="javascript:alert(1)" title="click me"></iframe>', 'click me'],
    ['a video', '<video src="javascript:alert(1)" title="play">go</video>', 'go'],
    ['an audio element', '<audio src="vbscript:msgbox(1)" title="listen">go</audio>', 'go'],
  ])('keeps the text of %s and drops the target', async (_name, html, text) => {
    const result = await convert(html, save);
    expect(result.markdown).not.toMatch(/javascript:|vbscript:/);
    expect(result.markdown).toBe(text);
  });

  it('drops an unsafe image, and the link it leaves empty, alt text and all', async () => {
    const result = await convert('<video poster="javascript:alert(1)">cap</video>', save);
    expect(result.markdown).toBe('');
  });

  it('still links an embedded image that was saved', async () => {
    const result = await convert(`<img alt="p" src="${png}">`, save);
    expect(result.markdown).toBe('![p](assets/image-c414cd0e204de974.png)');
    expect(result.images).toHaveLength(1);
  });
});
