import type { Root } from 'mdast';
import { visit } from 'unist-util-visit';

/**
 * rehype-remark marks an item as loose as soon as it holds a nested list with two items.
 * An item is loose only when it holds more than one paragraph or another block: it is
 * tight when its children are a leading paragraph, which is optional, followed by lists.
 */
export function tightenLists(tree: Root): void {
  visit(tree, 'listItem', (item) => {
    const [first, ...rest] = item.children;
    const blocks = first?.type === 'paragraph' ? rest : item.children;
    item.spread = !blocks.every((child) => child.type === 'list');
  });
  visit(tree, 'list', (list) => {
    list.spread = list.children.some((item) => item.spread);
  });
}
