import type { Element, Parent, Root } from 'hast';
import { visit } from 'unist-util-visit';
import { decodeDataUri, extensionForMime, imageFileName } from '../images';
import { imageLink } from '../paths';
import type { ConvertOptions, ConvertedImage, DropReason, DroppedImage } from '../types';

export interface ImageCollector {
  images: ConvertedImage[];
  dropped: DroppedImage[];
}

export async function rewriteImages(
  tree: Root,
  options: ConvertOptions,
  out: ImageCollector,
): Promise<void> {
  const found: { node: Element; parent: Parent }[] = [];
  visit(tree, 'element', (node, _index, parent) => {
    if (node.tagName === 'img' && parent) found.push({ node, parent });
  });

  for (const { node, parent } of found) {
    const src = String(node.properties['src'] ?? '');
    const drop = (reason: DropReason): void => {
      out.dropped.push({ source: src.slice(0, 40), reason });
      parent.children.splice(parent.children.indexOf(node), 1);
    };

    if (/^https?:\/\//i.test(src)) continue;
    if (!/^data:/i.test(src)) {
      drop('unsupported-source');
      continue;
    }
    const decoded = decodeDataUri(src);
    if (!decoded) {
      drop('undecodable');
      continue;
    }
    const extension = extensionForMime(decoded.mime);
    if (!extension) {
      drop('unsupported-type');
      continue;
    }
    if (!options.canSaveImages) {
      drop('cannot-save');
      continue;
    }
    const fileName = await imageFileName(decoded.bytes, extension);
    if (!out.images.some((image) => image.fileName === fileName)) {
      out.images.push({ fileName, bytes: decoded.bytes });
    }
    node.properties['src'] = imageLink(options.imageDestination, fileName);
  }
}
