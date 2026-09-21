import type { Root } from 'mdast';
import { visit } from 'unist-util-visit';
import type { DroppedImage } from './types';

/**
 * Renderers other than VS Code's preview may not block these schemes, so the target goes
 * and only the text stays. The check lives on the Markdown tree rather than on the HTML,
 * because rehype-remark turns far more than `<a>` into a link or an image — `<iframe>`,
 * `<video>`, `<audio>` and a video's `poster` among them.
 *
 * By this point `rewriteImages` has already given every saved image a relative path and
 * removed the ones it dropped, so no legitimate `data:` image target is left here.
 */
function hasUnsafeScheme(url: string): boolean {
  const target = url.replace(/[\s\u0000-\u001f\u007f]/g, '').toLowerCase();
  return /^(javascript|vbscript|data):/.test(target);
}

export function dropUnsafeTargets(tree: Root, dropped: DroppedImage[]): void {
  visit(tree, (node, index, parent) => {
    if (!parent || index === undefined) return undefined;
    if (node.type === 'image' && hasUnsafeScheme(node.url)) {
      dropped.push({ source: node.url.slice(0, 40), reason: 'unsupported-source' });
      parent.children.splice(index, 1);
      return index;
    }
    if (node.type === 'link' && hasUnsafeScheme(node.url)) {
      parent.children.splice(index, 1, ...node.children);
      return index;
    }
    return undefined;
  });
  // a link whose only content was such an image now says nothing at all — and removing
  // it can empty out a link that wraps it in turn, so repeat until nothing more changes
  let removedAny: boolean;
  do {
    removedAny = false;
    visit(tree, 'link', (node, index, parent) => {
      if (!parent || index === undefined || node.children.length > 0) return undefined;
      parent.children.splice(index, 1);
      removedAny = true;
      return index;
    });
  } while (removedAny);
}
