import { describe, expect, it } from 'vitest';
import { summarizeDropped } from '../../src/core/dropped';

describe('summarizeDropped', () => {
  it('is undefined when nothing was dropped', () => {
    expect(summarizeDropped([])).toBeUndefined();
  });
  it('summarizes all dropped images in one message, grouped by reason', () => {
    expect(
      summarizeDropped([
        { source: 'a', reason: 'unsupported-source' },
        { source: 'b', reason: 'unsupported-source' },
        { source: 'c', reason: 'cannot-save' },
      ]),
    ).toBe(
      'Paste as Markdown: 3 images were not pasted (2 from a source that cannot be linked, 1 embedded image that cannot be saved because the document has no folder).',
    );
  });
  it('uses the singular for one image', () => {
    expect(summarizeDropped([{ source: 'a', reason: 'unsupported-type' }])).toBe(
      'Paste as Markdown: 1 image was not pasted (1 of an unsupported type).',
    );
  });
});
