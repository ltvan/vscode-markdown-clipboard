import type { Element } from 'hast';

/** The element's inline style, lower-cased and without whitespace, ready for regex tests. */
export function styleOf(node: Element): string {
  return String(node.properties['style'] ?? '')
    .toLowerCase()
    .replace(/\s+/g, '');
}
