import type { Element, ElementContent, Root } from 'hast';
import { SKIP, visit } from 'unist-util-visit';
import { styleOf } from './style';

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
  for (const child of list.children) {
    if (isList(child) && lastItem) lastItem.children.push(child);
    else {
      children.push(child);
      if (child.type === 'element' && child.tagName === 'li') lastItem = child;
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
    if (node.tagName === 'th') hasHeader = true;
    if (node.tagName === 'tr') firstRow ??= node;
    return undefined;
  });
  if (hasHeader || !firstRow) return;
  for (const cell of firstRow.children) {
    if (cell.type === 'element' && cell.tagName === 'td') cell.tagName = 'th';
  }
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
    // Word's <o:p> and friends
    if (node.tagName.includes(':')) {
      parent.children.splice(index, 1);
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
}
