import type { Nodes } from 'hast';

/** Concatenates the text a node contains, ignoring markup. */
export const textOf = (node: Nodes): string =>
  node.type === 'text' ? node.value : 'children' in node ? node.children.map(textOf).join('') : '';
