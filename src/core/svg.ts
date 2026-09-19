/**
 * A saved SVG ends up in the repository and may later be served from the project's own
 * origin, where its scripts would run. Sanitizing is not attempted: a wrong sanitizer
 * gives false safety, while a false positive here only drops an image.
 *
 * What is accepted is an allow-list, not a block-list: a block-list is bypassed by any
 * spelling it did not anticipate — a namespace prefix, an exotic encoding, an element
 * that rewrites an attribute after load. Anything this file does not positively
 * recognise is unclean.
 */

/** The drawing elements of SVG 1.1, without any that can script, load or animate. */
const ALLOWED_TAGS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'title',
  'desc',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textpath',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'mask',
  'pattern',
  'marker',
  'image',
  'filter',
  'feblend',
  'fecolormatrix',
  'fecomponenttransfer',
  'fecomposite',
  'feconvolvematrix',
  'fediffuselighting',
  'fedisplacementmap',
  'fedistantlight',
  'fedropshadow',
  'feflood',
  'fefunca',
  'fefuncb',
  'fefuncg',
  'fefuncr',
  'fegaussianblur',
  'feimage',
  'femerge',
  'femergenode',
  'femorphology',
  'feoffset',
  'fepointlight',
  'fespecularlighting',
  'fespotlight',
  'fetile',
  'feturbulence',
]);

/** Every `<name` and `</name` token; the name is empty when the markup is malformed. */
const TAG = /<\/?\s*([^\s/>]*)/g;
/** `href`, `xlink:href` and `src`, quoted either way or not at all. */
const REFERENCE = /(?:xlink:)?(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/g;
/** The argument of a `url(…)`, past any whitespace and an optional quote. */
const URL_ARGUMENT = /url\(\s*["']?\s*([^)"']*)/g;
/** An `on…=` attribute, recognised by what may precede an attribute name. */
const EVENT_HANDLER = /[\s"'/]on[a-z]+\s*=/;
const COMMENT = /<!--[\s\S]*?-->/g;
/** An XML declaration, as opposed to any other processing instruction. */
const XML_DECLARATION = /^<\?xml[\s?]/;
/** A character reference inside a tag, which can spell an attribute name these checks would miss. */
const REFERENCE_IN_TAG = /<[^>]*&/;

/** True only for an SVG built entirely of drawing elements that reference nothing outside itself. */
export function isCleanSvg(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false; // not UTF-8: another encoding could hide anything from these checks
  }
  if (text.includes('\u0000')) return false;
  const source = (text.startsWith('﻿') ? text.slice(1) : text).toLowerCase();

  if (source.includes('<!doctype') || source.includes('<!entity')) return false;
  if (source.includes('<![cdata[')) return false;
  if (source.includes('@import') || source.includes('attributename')) return false;
  if (source.includes('javascript:') || source.includes('data:')) return false;
  if (EVENT_HANDLER.test(source)) return false;

  // one XML declaration may lead, and nothing else may be a processing instruction
  let rest = source.trimStart();
  const declarations = XML_DECLARATION.test(rest) ? 1 : 0;
  if (declarations === 1) {
    const end = rest.indexOf('?>');
    if (end < 0) return false;
    rest = rest.slice(end + 2).trimStart();
  }
  if ((source.match(/<\?/g) ?? []).length !== declarations) return false;

  // comments may lead too, and the root element must be an unprefixed <svg>
  while (rest.startsWith('<!--')) {
    const end = rest.indexOf('-->');
    if (end < 0) return false;
    rest = rest.slice(end + 3).trimStart();
  }
  if (!/^<svg[\s/>]/.test(rest)) return false;

  const body = rest.replace(COMMENT, ' ');
  // `on&#x6c;oad=` is an event handler once parsed, and `u\72 l(…)` is a url() once parsed:
  // neither spelling is worth supporting, and both would walk past the checks below
  if (REFERENCE_IN_TAG.test(body) || body.includes('\\')) return false;
  for (const [, name] of body.matchAll(TAG)) {
    if (!ALLOWED_TAGS.has(name ?? '')) return false;
  }
  for (const match of body.matchAll(REFERENCE)) {
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    if (!value.trim().startsWith('#')) return false;
  }
  for (const match of body.matchAll(URL_ARGUMENT)) {
    if (!(match[1] ?? '').startsWith('#')) return false;
  }
  return true;
}
