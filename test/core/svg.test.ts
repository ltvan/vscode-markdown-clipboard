import { describe, expect, it } from 'vitest';
import { isCleanSvg } from '../../src/core/svg';

const svg = (source: string): Uint8Array => new TextEncoder().encode(source);

describe('isCleanSvg', () => {
  it.each([
    '<svg/>',
    '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L1 1" fill="url(#g)"/></svg>',
    '<svg><use href="#a"/></svg>',
    '<svg><use xlink:href="#a"/></svg>',
  ])('accepts %j', (source) => {
    expect(isCleanSvg(svg(source))).toBe(true);
  });

  it.each([
    ['a script', '<svg><script>alert(1)</script></svg>'],
    ['an event handler', '<svg onload="alert(1)"/>'],
    ['a foreign object', '<svg><foreignObject><b>x</b></foreignObject></svg>'],
    ['an external href', '<svg><image href="https://x/y.png"/></svg>'],
    ['an external xlink:href', '<svg><image xlink:href="http://x"/></svg>'],
    ['an external src', '<svg><image src="http://x/y.png"/></svg>'],
    ['an external url()', '<svg><rect style="fill:url(https://x)"/></svg>'],
    ['an import', '<svg><style>@import url(x.css);</style></svg>'],
    ['an entity declaration', '<svg><!ENTITY x "y"></svg>'],
    ['a doctype with an internal subset', '<!DOCTYPE svg [<!ENTITY x "y">]><svg/>'],
  ])('rejects %s', (_name, source) => {
    expect(isCleanSvg(svg(source))).toBe(false);
  });
});
