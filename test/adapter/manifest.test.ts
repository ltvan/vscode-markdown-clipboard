import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

describe('manifest', () => {
  it('offers the command in the palette only for Markdown editors', () => {
    expect(manifest.contributes.commands).toEqual([
      {
        command: 'markdownClipboard.pasteAsMarkdown',
        title: 'Paste as Markdown',
        category: 'Markdown Clipboard',
      },
    ]);
    expect(manifest.contributes.menus.commandPalette).toEqual([
      { command: 'markdownClipboard.pasteAsMarkdown', when: 'editorLangId == markdown' },
    ]);
  });

  it('ships no default keybinding', () => {
    expect(manifest.contributes.keybindings).toBeUndefined();
  });

  it('declares the image destination as a resource-scoped setting defaulting to assets', () => {
    const setting =
      manifest.contributes.configuration.properties['markdownClipboard.imageDestination'];
    expect(setting.default).toBe('assets');
    expect(setting.scope).toBe('resource');
  });

  it('requires the first VS Code release with the stable paste API', () => {
    expect(manifest.engines.vscode).toBe('^1.97.0');
  });
});
