import type { Element, Parent, Root } from 'hast';
import { visit } from 'unist-util-visit';
import { decodeDataUri, extensionForMime, imageFileName } from '../images';
import { imageLink } from '../paths';
import { isCleanSvg } from '../svg';
import type { ConvertOptions, ConvertedImage, DropReason, DroppedImage } from '../types';

export interface ImageCollector {
  images: ConvertedImage[];
  dropped: DroppedImage[];
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

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
    if (decoded.mime === 'image/svg+xml' && !isCleanSvg(decoded.bytes)) {
      drop('unsafe-svg');
      continue;
    }
    if (!options.canSaveImages) {
      drop('cannot-save');
      continue;
    }
    const fileName = await imageFileName(decoded.bytes, extension);
    const taken = out.images.find((image) => image.fileName === fileName);
    if (!taken) {
      out.images.push({ fileName, bytes: decoded.bytes });
    } else if (!sameBytes(taken.bytes, decoded.bytes)) {
      // practically impossible with 16 hex digits, but the paste must not link the wrong bytes
      drop('name-collision');
      continue;
    }
    node.properties['src'] = imageLink(options.imageDestination, fileName);
  }
}
