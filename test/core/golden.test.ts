import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { convert } from '../../src/core/convert';

const fixtures = new URL('./fixtures/', import.meta.url);

describe('golden fixtures', () => {
  // directories only: macOS drops .DS_Store files here
  const names = readdirSync(fixtures, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const name of names) {
    it(name, async () => {
      const html = readFileSync(new URL(`${name}/input.html`, fixtures), 'utf8');
      const expected = readFileSync(new URL(`${name}/expected.md`, fixtures), 'utf8');
      const result = await convert(html, { imageDestination: 'assets', canSaveImages: true });
      expect(`${result.markdown}\n`).toBe(expected);
    });
  }
});
