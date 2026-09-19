import * as vscode from 'vscode';
import { beforeEach, describe, expect, it } from 'vitest';
import { testing, window as stubWindow } from './vscodeStub';
import { pasteAsMarkdown } from '../../src/vscode/pasteCommand';

describe('pasteAsMarkdown', () => {
  beforeEach(() => testing.reset());

  it('runs paste-as with our kind in a Markdown editor', async () => {
    stubWindow.activeTextEditor = { document: { languageId: 'markdown' } };
    await pasteAsMarkdown();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('editor.action.pasteAs', {
      kind: 'markdown.fromHtml',
    });
  });

  it.each([undefined, { document: { languageId: 'plaintext' } }])(
    'does nothing for %j',
    async (editor) => {
      stubWindow.activeTextEditor = editor;
      await pasteAsMarkdown();
      expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    },
  );
});
