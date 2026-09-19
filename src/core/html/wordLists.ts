import type { Element, ElementContent, Nodes, Root } from 'hast';
import { visit } from 'unist-util-visit';
import { styleOf } from './style';

interface ListItem {
  level: number;
  ordered: boolean;
  children: ElementContent[];
}

interface Frame {
  level: number;
  list: Element | undefined;
  lastItem: Element | undefined;
}

const textOf = (node: Nodes): string =>
  node.type === 'text' ? node.value : 'children' in node ? node.children.map(textOf).join('') : '';

const element = (tagName: string, children: ElementContent[]): Element => ({
  type: 'element',
  tagName,
  properties: {},
  children,
});

function isListParagraph(node: ElementContent): node is Element {
  return (
    node.type === 'element' && node.tagName === 'p' && /mso-list:(?!none|skip)/.test(styleOf(node))
  );
}

/** Removes Word's literal marker (`·`, `o`, `1.`) and returns its text. */
function takeMarker(paragraph: Element): string {
  let marker = '';
  visit(paragraph, 'element', (node, index, parent) => {
    if (!parent || index === undefined || !/mso-list:ignore/.test(styleOf(node))) return undefined;
    marker = textOf(node);
    parent.children.splice(index, 1);
    return false;
  });
  return marker.trim();
}

function buildLists(items: ListItem[]): Element[] {
  const top: Element[] = [];
  const stack: Frame[] = [{ level: 0, list: undefined, lastItem: undefined }];
  for (const item of items) {
    while (stack.length > 1 && (stack.at(-1)?.level ?? 0) > item.level) stack.pop();
    let frame = stack.at(-1)!;
    // only the outermost frame survives the pop above while still being too deep: it
    // adopted a list that started below level 1, so its level follows the shallower item
    if (frame.level > item.level) frame.level = item.level;
    if (frame.level < item.level || !frame.list) {
      const list = element(item.ordered ? 'ol' : 'ul', []);
      if (frame.lastItem) frame.lastItem.children.push(list);
      else top.push(list);
      if (frame.list) {
        frame = { level: item.level, list, lastItem: undefined };
        stack.push(frame);
      } else {
        // the frame is still empty (a list starting below level 1): it becomes this list
        frame.level = item.level;
        frame.list = list;
      }
    }
    const listItem = element('li', item.children);
    frame.list!.children.push(listItem);
    frame.lastItem = listItem;
  }
  return top;
}

/** Word pastes a list as consecutive `<p style="mso-list:l0 level1 lfo1">` paragraphs. */
export function rebuildWordLists(tree: Root): void {
  visit(tree, (parent) => {
    if (!('children' in parent)) return;
    const rebuilt: ElementContent[] = [];
    let run: ListItem[] = [];
    const flush = (): void => {
      rebuilt.push(...buildLists(run));
      run = [];
    };
    for (const child of parent.children as ElementContent[]) {
      if (isListParagraph(child)) {
        const level = Number(/mso-list:[^;]*level(\d+)/.exec(styleOf(child))?.[1] ?? 1);
        const marker = takeMarker(child);
        run.push({
          level,
          ordered: /^(\d+|[a-z]{1,3})[.)]/i.test(marker),
          children: child.children,
        });
      } else if (
        run.length > 0 &&
        (child.type === 'comment' || (child.type === 'text' && child.value.trim() === ''))
      ) {
        continue; // whitespace and Word's conditional comments between list paragraphs
      } else {
        flush();
        rebuilt.push(child);
      }
    }
    flush();
    (parent.children as ElementContent[]) = rebuilt;
  });
}
