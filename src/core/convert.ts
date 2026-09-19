import type { Root } from 'hast';
import type { Root as MdastRoot } from 'mdast';
import rehypeParse from 'rehype-parse';
import rehypeRemark from 'rehype-remark';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { clean } from './html/clean';
import { type ImageCollector, rewriteImages } from './html/images';
import { rebuildWordLists } from './html/wordLists';
import { dropUnsafeTargets } from './safeLinks';
import { tightenLists } from './tightLists';
import type { ConvertOptions, ConvertResult } from './types';

export async function convert(html: string, options: ConvertOptions): Promise<ConvertResult> {
  const collected: ImageCollector = { images: [], dropped: [] };
  const file = await unified()
    .use(rehypeParse, { fragment: true })
    // before clean(): the list markers are found by their mso-list style
    .use(() => (tree: Root) => rebuildWordLists(tree))
    .use(() => (tree: Root) => clean(tree))
    .use(() => (tree: Root) => rewriteImages(tree, options, collected))
    // <u> has no Markdown equivalent: keep its text, not an emphasis
    .use(rehypeRemark, { handlers: { u: (state, node) => state.all(node) } })
    // after rehypeRemark: <iframe>, <video> and friends only become links there
    .use(() => (tree: MdastRoot) => dropUnsafeTargets(tree))
    .use(() => (tree: MdastRoot) => tightenLists(tree))
    .use(remarkGfm)
    .use(remarkStringify, {
      bullet: '-',
      emphasis: '_',
      rule: '-',
      fences: true,
      listItemIndent: 'one',
    })
    .process(html);
  return { markdown: String(file).replace(/\n$/, ''), ...collected };
}
