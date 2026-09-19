/**
 * A saved SVG ends up in the repository and may later be served from the project's own
 * origin, where its scripts would run. Sanitizing is not attempted: a wrong sanitizer
 * gives false safety, while a false positive here only drops an image.
 */

/** `href`, `xlink:href` and `src`, with the attribute's value in one of three groups. */
const REFERENCE = /(?:xlink:)?(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/g;
/** The argument of a `url(…)`, past an optional quote and spaces. */
const URL_ARGUMENT = /url\(\s*["']?\s*([^)"']*)/g;
/** An `on…=` attribute, recognised by what may precede an attribute name. */
const EVENT_HANDLER = /[\s"'/]on[a-z]+\s*=/;
/** A doctype carrying an internal subset, which is where entity declarations hide. */
const INTERNAL_SUBSET = /<!doctype[^>]*\[/;

/** True when the SVG has no script, no event handler and no reference outside itself. */
export function isCleanSvg(bytes: Uint8Array): boolean {
  const source = new TextDecoder().decode(bytes).toLowerCase();
  if (source.includes('<script') || source.includes('<foreignobject')) return false;
  if (source.includes('@import') || source.includes('<!entity')) return false;
  if (EVENT_HANDLER.test(source) || INTERNAL_SUBSET.test(source)) return false;
  for (const match of source.matchAll(REFERENCE)) {
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    if (!value.trim().startsWith('#')) return false;
  }
  for (const match of source.matchAll(URL_ARGUMENT)) {
    if (!(match[1] ?? '').startsWith('#')) return false;
  }
  return true;
}
