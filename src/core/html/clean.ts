import type { Element, ElementContent, Nodes, Root } from 'hast';
import { SKIP, visit } from 'unist-util-visit';
import { styleOf } from './style';
import { textOf } from './text';

/** Google Docs expresses emphasis as styled spans; one span can carry several. */
function tagsForStyle(style: string): string[] {
  const tags: string[] = [];
  if (/font-weight:(bold|[6-9]00)/.test(style)) tags.push('strong');
  if (/font-style:italic/.test(style)) tags.push('em');
  if (/text-decoration[^;]*line-through/.test(style)) tags.push('del');
  return tags;
}

const isList = (node: ElementContent): node is Element =>
  node.type === 'element' && (node.tagName === 'ul' || node.tagName === 'ol');

/** Google Docs puts a nested list next to its parent item, not inside it. */
function adoptSiblingLists(list: Element): void {
  const children: ElementContent[] = [];
  let lastItem: Element | undefined;
  const keep = (child: ElementContent): void => {
    children.push(child);
    if (child.type === 'element' && child.tagName === 'li') lastItem = child;
  };
  for (const child of list.children) {
    if (!isList(child)) {
      keep(child);
      continue;
    }
    // a sibling list before the first item has nothing to nest under
    if (!lastItem) {
      for (const item of child.children) keep(item);
      continue;
    }
    // several sibling lists in a row belong to one nested list, not to one each
    const nested = lastItem.children.at(-1);
    if (nested !== undefined && isList(nested) && nested.tagName === child.tagName) {
      nested.children.push(...child.children);
    } else {
      lastItem.children.push(child);
    }
  }
  list.children = children;
}

/** Word and Google Docs tables have no header row, but a GFM table must have one. */
function promoteFirstRowToHeader(table: Element): void {
  let hasHeader = false;
  let firstRow: Element | undefined;
  visit(table, 'element', (node) => {
    if (node !== table && node.tagName === 'table') return SKIP;
    if (node.tagName === 'tr') firstRow ??= node;
    // only the first row can become the header, so a <th> in a later row is not one
    if (node.tagName === 'th' && firstRow?.children.includes(node)) hasHeader = true;
    return undefined;
  });
  if (hasHeader || !firstRow) return;
  for (const cell of firstRow.children) {
    if (cell.type === 'element' && cell.tagName === 'td') cell.tagName = 'th';
  }
}

const containsImage = (node: Nodes): boolean =>
  (node.type === 'element' && node.tagName === 'img') ||
  ('children' in node && node.children.some(containsImage));

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
 * only whitespace (Word's `<p><o:p>&nbsp;</o:p></p>`; `\s` already matches NBSP), and a
 * `<br>` with a block element, or nothing, on both sides (Google Docs). A `<br>` next to
 * real text or an inline element is a genuine line break and must survive regardless of
 * what its *parent* is — deciding by parent tag alone would delete a soft break inside a
 * `<div>` or at the root. Never descends into a `<pre>`: its content is verbatim. Runs
 * after the main visit so `<o:p>` and the Google Docs `<b>` wrapper are already unwrapped
 * down to their text/children — otherwise an empty paragraph's text would not yet be visible.
 */
function removeStrayEmptiness(tree: Root): void {
  visit(tree, (node, index, parent) => {
    if (!parent || index === undefined || node.type !== 'element') return undefined;
    if (node.tagName === 'pre') return SKIP;
    if (node.tagName === 'p' && !containsImage(node) && /^\s*$/.test(textOf(node))) {
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

/** Strips source-application markup that would otherwise leak into the Markdown. */
export function clean(tree: Root): void {
  visit(tree, (node, index, parent) => {
    if (!parent || index === undefined) return undefined;
    if (node.type === 'comment') {
      parent.children.splice(index, 1);
      return [SKIP, index];
    }
    if (node.type !== 'element') return undefined;
    // hast-util-to-mdast resolves every href and src against a <base>, which a clipboard
    // fragment must not be allowed to rewrite links with — and an unsafe href there throws
    if (node.tagName === 'base') {
      parent.children.splice(index, 1);
      return [SKIP, index];
    }
    // Word's <o:p> and its smart tags: the wrapper goes, the text it wraps stays —
    // except for a namespaced script or style, whose content is not text to keep
    if (node.tagName.includes(':')) {
      const localName = node.tagName.slice(node.tagName.lastIndexOf(':') + 1);
      const dropped = localName === 'script' || localName === 'style';
      parent.children.splice(index, 1, ...(dropped ? [] : node.children));
      return [SKIP, index];
    }
    const style = styleOf(node);
    // Google Docs wraps the whole clipboard in <b style="font-weight:normal">
    if (node.tagName === 'b' && /font-weight:(normal|400)/.test(style)) {
      parent.children.splice(index, 1, ...node.children);
      return [SKIP, index];
    }
    if (isList(node)) adoptSiblingLists(node);
    if (node.tagName === 'table') promoteFirstRowToHeader(node);
    if (node.tagName === 'span') {
      const [outer, ...inner] = tagsForStyle(style);
      if (outer) {
        node.tagName = outer;
        node.properties = {};
        for (const tagName of inner) {
          node.children = [{ type: 'element', tagName, properties: {}, children: node.children }];
        }
      }
    }
    return undefined;
  });
  removeStrayEmptiness(tree);
}
