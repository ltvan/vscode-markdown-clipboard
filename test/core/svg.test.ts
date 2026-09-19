import { describe, expect, it } from 'vitest';
import { isCleanSvg } from '../../src/core/svg';

const svg = (source: string): Uint8Array => new TextEncoder().encode(source);
const withBom = (source: string): Uint8Array => svg(`﻿${source}`);
/** What a Windows editor writes: every ASCII character followed by a NUL byte. */
const utf16le = (source: string): Uint8Array => {
  const bytes = new Uint8Array(2 + source.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let index = 0; index < source.length; index++) {
    bytes[2 + index * 2] = source.charCodeAt(index) & 0xff;
    bytes[3 + index * 2] = source.charCodeAt(index) >> 8;
  }
  return bytes;
};

describe('isCleanSvg', () => {
  it.each([
    ['a bare root', '<svg/>'],
    [
      'drawing with a gradient',
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs><path d="M0 0 L1 1" fill="url(#g)"/></svg>',
    ],
    ['an internal use', '<svg><use href="#a"/></svg>'],
    ['an internal xlink:use', '<svg><use xlink:href="#a"/></svg>'],
    ['a byte-order mark', '﻿<svg><rect width="1" height="1"/></svg>'],
    ['an xml declaration', '<?xml version="1.0" encoding="UTF-8"?><svg><circle r="1"/></svg>'],
    ['a leading comment', '<!-- drawn by hand --><svg><line x1="0" y1="0" x2="1" y2="1"/></svg>'],
    [
      'a filter chain',
      '<svg><filter id="f"><feGaussianBlur stdDeviation="2"/><feMerge><feMergeNode/></feMerge></filter></svg>',
    ],
    ['text', '<svg><text x="0" y="0"><tspan>hi</tspan></text></svg>'],
  ])('accepts %s', (_name, source) => {
    expect(isCleanSvg(svg(source))).toBe(true);
  });

  it.each([
    ['a script', '<svg><script>alert(1)</script></svg>'],
    [
      'a namespaced script',
      '<svg xmlns:svg="http://www.w3.org/2000/svg"><svg:script>alert(1)</svg:script></svg>',
    ],
    [
      'a namespaced foreign object',
      '<svg xmlns:s="http://www.w3.org/2000/svg"><s:foreignObject><b>x</b></s:foreignObject></svg>',
    ],
    [
      'an animated href',
      '<svg><a href="#x"><set attributeName="href" to="javascript:alert(1)"/><text>click</text></a></svg>',
    ],
    ['a link element', '<svg><a href="#x"/></svg>'],
    ['a style element', '<svg><style>*{fill:red}</style></svg>'],
    ['an event handler', '<svg onload="alert(1)"/>'],
    ['a mixed-case event handler', '<svg OnLoad="alert(1)"/>'],
    ['a foreign object', '<svg><foreignObject><b>x</b></foreignObject></svg>'],
    ['an external href', '<svg><image href="https://x/y.png"/></svg>'],
    ['an unquoted external href', '<svg><image href=https://x/y.png /></svg>'],
    ['an external xlink:href', '<svg><image xlink:href="http://x"/></svg>'],
    ['an external src', '<svg><image src="http://x/y.png"/></svg>'],
    ['an external url()', '<svg><rect style="fill:url(https://x)"/></svg>'],
    ['a spaced external url()', '<svg><rect style="fill:url( \n \'https://x\' )"/></svg>'],
    ['an import', '<svg><rect style="@import url(x.css)"/></svg>'],
    ['an entity declaration', '<!DOCTYPE svg [<!ENTITY x "y">]><svg/>'],
    ['a doctype', '<!DOCTYPE svg><svg/>'],
    ['a CDATA section', '<svg><title><![CDATA[x]]></title></svg>'],
    ['a stylesheet instruction', '<?xml-stylesheet href="x"?><svg/>'],
    ['an iframe', '<svg><iframe src="#"/></svg>'],
    ['an animation', '<svg><animate attributeName="x" to="1"/></svg>'],
    ['something other than svg at the root', '<html><svg/></html>'],
    ['a prefixed root', '<svg:svg xmlns:svg="http://www.w3.org/2000/svg"/>'],
    ['a javascript url anywhere', '<svg><desc>javascript:alert(1)</desc></svg>'],
    ['a handler name spelled with a character reference', '<svg on&#x6c;oad="alert(1)"/>'],
    [
      'a url token spelled with a CSS escape',
      '<svg><rect style="fill:u\\72 l(https://evil/x)"/></svg>',
    ],
  ])('rejects %s', (_name, source) => {
    expect(isCleanSvg(svg(source))).toBe(false);
  });

  it('rejects a UTF-16LE document, whose NUL bytes hide its content', () => {
    expect(isCleanSvg(utf16le('<svg><script>alert(1)</script></svg>'))).toBe(false);
    expect(isCleanSvg(utf16le('<svg/>'))).toBe(false);
  });

  it('rejects bytes that are not valid UTF-8', () => {
    expect(isCleanSvg(new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0xff, 0xfe, 0x2f, 0x3e]))).toBe(
      false,
    );
  });

  it('rejects a byte-order mark in front of a script', () => {
    expect(isCleanSvg(withBom('<svg><script>alert(1)</script></svg>'))).toBe(false);
  });
});
