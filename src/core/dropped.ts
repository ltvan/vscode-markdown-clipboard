import type { DropReason, DroppedImage } from './types';

const REASON_TEXT: Record<DropReason, (count: number) => string> = {
  'unsupported-source': (n) => `${n} from a source that cannot be linked`,
  'unsupported-type': (n) => `${n} of an unsupported type`,
  undecodable: (n) => `${n} that could not be decoded`,
  'cannot-save': (n) =>
    `${n} embedded ${n === 1 ? 'image' : 'images'} that cannot be saved because the document has no folder`,
  'unsafe-svg': (n) =>
    `${n} SVG ${n === 1 ? 'image' : 'images'} that did not pass the safety check`,
  'name-collision': (n) => `${n} whose file name collided with another image`,
};

export function summarizeDropped(dropped: DroppedImage[]): string | undefined {
  if (dropped.length === 0) return undefined;
  const counts = new Map<DropReason, number>();
  for (const { reason } of dropped) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const details = [...counts].map(([reason, count]) => REASON_TEXT[reason](count)).join(', ');
  const subject = dropped.length === 1 ? '1 image was' : `${dropped.length} images were`;
  return `Paste as Markdown: ${subject} not pasted (${details}).`;
}
