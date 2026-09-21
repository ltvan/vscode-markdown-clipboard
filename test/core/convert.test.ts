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

describe('convert: stray content between blocks', () => {
  it('drops a paragraph holding only a non-breaking space', async () => {
    const result = await convert('<p>a</p><p>&nbsp;</p><p>b</p>', save);
    expect(result.markdown).toBe('a\n\nb');
  });

  it('drops a <br> sitting directly between block elements', async () => {
    const result = await convert('<p>a</p><br><p>b</p>', save);
    expect(result.markdown).toBe('a\n\nb');
  });

  it('keeps an image-only paragraph, even though its text is empty', async () => {
    const result = await convert('<p><img alt="x" src="https://e.com/a.png"></p>', save);
    expect(result.markdown).toBe('![x](https://e.com/a.png)');
  });

  it('keeps a <br> inside a paragraph as a real line break', async () => {
    const result = await convert('<p>one<br>two</p>', save);
    expect(result.markdown).toBe('one\\\ntwo');
  });

  it('drops two consecutive <br>s sitting between block elements', async () => {
    const result = await convert('<p>a</p><br><br><p>b</p>', save);
    expect(result.markdown).toBe('a\n\nb');
  });

  it('drops a <br> between nothing and a block at the start', async () => {
    const result = await convert('<br><p>a</p>', save);
    expect(result.markdown).toBe('a');
  });

  it('drops a <br> between a block and nothing at the end', async () => {
    const result = await convert('<p>a</p><br>', save);
    expect(result.markdown).toBe('a');
  });

  it('keeps a <br> between text inside a <div>, regardless of its parent tag', async () => {
    const result = await convert('<div>a<br>b</div>', save);
    expect(result.markdown).toBe('a\\\nb');
  });

  it('keeps a <br> between text at the root, regardless of its parent tag', async () => {
    const result = await convert('a<br>b', save);
    expect(result.markdown).toBe('a\\\nb');
  });

  it('keeps a <br> between text inside a <blockquote>, regardless of its parent tag', async () => {
    const result = await convert('<blockquote>a<br>b</blockquote>', save);
    expect(result.markdown).toBe('> a\\\n> b');
  });

  it('never alters a <br> inside a <pre>', async () => {
    const result = await convert('<pre>line1<br>line2</pre>', save);
    expect(result.markdown).toBe('```\nline1\nline2\n```');
  });

  it('never removes an empty paragraph inside a <pre>', async () => {
    const result = await convert('<pre>code<p>&nbsp;</p>more</pre>', save);
    expect(result.markdown).toBe('```\ncode\n\n \n\nmore\n```');
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

describe('convert: <base>', () => {
  it('drops a base with an unsafe href instead of failing the whole paste', async () => {
    const result = await convert('<base href="javascript:alert(1)"><a href="x">t</a>', save);
    expect(result.markdown).toBe('[t](x)');
  });

  it('does not rebase links against a base href', async () => {
    const result = await convert('<base href="https://site.example/dir/"><a href="x">t</a>', save);
    expect(result.markdown).toBe('[t](x)');
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

  it('drops an outer link left empty by removing the unsafe image it wrapped', async () => {
    const result = await convert(
      '<p>pre<a href="https://ok"><video poster="javascript:b"></video></a>post</p>',
      save,
    );
    expect(result.markdown).toBe('prepost');
  });

  it('still links an embedded image that was saved', async () => {
    const result = await convert(`<img alt="p" src="${png}">`, save);
    expect(result.markdown).toBe('![p](assets/image-c414cd0e204de974.png)');
    expect(result.images).toHaveLength(1);
  });

  it('reports an image removed for an unsafe target', async () => {
    const result = await convert('<video poster="data:image/png;base64,AAAA">cap</video>', save);
    expect(result.dropped).toEqual([
      { source: 'data:image/png;base64,AAAA', reason: 'unsupported-source' },
    ]);
  });

  it('does not report a link merely unwrapped for an unsafe target', async () => {
    const result = await convert('<a href="javascript:alert(1)">click</a>', save);
    expect(result.markdown).toBe('click');
    expect(result.dropped).toEqual([]);
  });
});

describe('convert: non-breaking spaces', () => {
  it('turns the NBSP either side of an inline element into a regular space', async () => {
    const result = await convert(
      '<p>feature of the<span>&nbsp;</span><strong>Markdown Wiki Links</strong>' +
        '<span>&nbsp;</span>extension</p>',
      save,
    );
    expect(result.markdown).toBe('feature of the **Markdown Wiki Links** extension');
    expect(result.markdown.includes(' ')).toBe(false);
  });

  it('turns an NBSP between words into a regular space', async () => {
    const result = await convert('<p>10&nbsp;km</p>', save);
    expect(result.markdown).toBe('10 km');
  });

  it('keeps an NBSP inside inline code', async () => {
    const result = await convert('<p><code>a&nbsp;b</code></p>', save);
    expect(result.markdown).toBe('`a b`');
  });

  it('keeps an NBSP inside a <pre> block', async () => {
    const result = await convert('<pre>a&nbsp;b</pre>', save);
    expect(result.markdown).toBe('```\na b\n```');
  });
});

describe('convert: links copied from the VS Code Markdown preview', () => {
  it('uses data-href as the link target instead of the webview href', async () => {
    const result = await convert(
      '<a href="https://file+.vscode-resource.vscode-cdn.net/Users/user/proj/README.md" ' +
        'data-href="../../../../README.md">Sample Workspace</a>',
      save,
    );
    expect(result.markdown).toBe('[Sample Workspace](../../../../README.md)');
  });

  it('still runs the unsafe-scheme guard against a data-href target', async () => {
    const result = await convert(
      '<a href="https://ok.example/" data-href="javascript:alert(1)">x</a>',
      save,
    );
    expect(result.markdown).toBe('x');
  });

  it('leaves a link with no data-href unchanged', async () => {
    const result = await convert('<a href="https://ok.example/">x</a>', save);
    expect(result.markdown).toBe('[x](https://ok.example/)');
  });

  it('keeps the original href when data-href is empty', async () => {
    const result = await convert('<a href="https://a.example/" data-href="">x</a>', save);
    expect(result.markdown).toBe('[x](https://a.example/)');
  });
});
