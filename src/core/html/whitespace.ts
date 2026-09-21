import type { ElementContent, Nodes, Root } from 'hast';
import { SKIP, visit } from 'unist-util-visit';
import { textOf } from './text';

// elements a browser replaces with external content: a paragraph holding only one of
// these has real content even though its text is empty
const EMBEDDED_TAGS = new Set([
  'img',
  'iframe',
  'video',
  'audio',
  'embed',
  'object',
  'picture',
  'svg',
]);

const containsEmbeddedElement = (node: Nodes): boolean =>
  (node.type === 'element' && EMBEDDED_TAGS.has(node.tagName)) ||
  ('children' in node && node.children.some(containsEmbeddedElement));

// tags whose boundary is a real break on its own, so a <br> right against one is redundant
const BLOCK_TAGS = new Set([
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'table',
  'blockquote',
  'pre',
  'hr',
  'section',
  'article',
  'header',
  'footer',
  'details',
  'figure',
  'dl',
]);

const isWhitespaceText = (node: ElementContent): boolean =>
  node.type === 'text' && node.value.trim() === '';

const isVerbatim = (node: Nodes): boolean =>
  node.type === 'element' && (node.tagName === 'pre' || node.tagName === 'code');

/**
 * Chrome/VS Code copy the space around an inline element as a span holding a lone NBSP.
 * Elsewhere it leaks U+00A0 into the Markdown where a reader expects an ordinary space.
 * `<pre>` and `<code>` stay byte-identical: their content is verbatim.
 */
export function normalizeNbsp(tree: Root): void {
  visit(tree, (node) => {
    if (isVerbatim(node)) return SKIP;
    if (node.type === 'text') node.value = node.value.replace(/ /g, ' ');
    return undefined;
  });
}

const isBr = (node: ElementContent): boolean => node.type === 'element' && node.tagName === 'br';

/** The nearest sibling in `direction` that isn't whitespace-only text or another `<br>`. */
function significantSibling(
  siblings: ElementContent[],
  from: number,
  direction: 1 | -1,
): ElementContent | undefined {
  for (let i = from + direction; i >= 0 && i < siblings.length; i += direction) {
    const sibling = siblings[i];
    if (sibling && !isWhitespaceText(sibling) && !isBr(sibling)) return sibling;
  }
  return undefined;
}

/** Whether nothing sits on this side, or what's there is itself a block boundary. */
const isBlockOrAbsent = (node: ElementContent | undefined): boolean =>
  node === undefined || (node.type === 'element' && BLOCK_TAGS.has(node.tagName));

/**
 * Drops the stray filler clipboard apps leave between real blocks: a `<p>` whose text is
 * only whitespace (Word's `<p><o:p>&nbsp;</o:p></p>`; `\s` already matches NBSP) and which
 * holds no embedded element (an `<iframe>`, `<video>` and the like have real content even
 * with no text of their own), and a `<br>` with a block element, or nothing, on both sides
 * (Google Docs). A `<br>` next to real text or an inline element is a genuine line break
 * and must survive regardless of what its *parent* is — deciding by parent tag alone would
 * delete a soft break inside a `<div>` or at the root. Never descends into a `<pre>`: its
 * content is verbatim. Runs after the main visit so `<o:p>` and the Google Docs `<b>`
 * wrapper are already unwrapped down to their text/children — otherwise an empty
 * paragraph's text would not yet be visible.
 */
export function removeStrayEmptiness(tree: Root): void {
  visit(tree, (node, index, parent) => {
    if (!parent || index === undefined || node.type !== 'element') return undefined;
    if (node.tagName === 'pre') return SKIP;
    if (node.tagName === 'p' && !containsEmbeddedElement(node) && /^\s*$/.test(textOf(node))) {
      parent.children.splice(index, 1);
      return [SKIP, index];
    }
    if (node.tagName === 'br') {
      const siblings = parent.children as ElementContent[];
      const before = significantSibling(siblings, index, -1);
      const after = significantSibling(siblings, index, 1);
      if (isBlockOrAbsent(before) && isBlockOrAbsent(after)) {
        parent.children.splice(index, 1);
        return [SKIP, index];
      }
    }
    return undefined;
  });
}
