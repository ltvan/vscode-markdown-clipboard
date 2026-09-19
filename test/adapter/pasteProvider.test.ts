import * as vscode from 'vscode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testing, Uri as StubUri, type WorkspaceEdit } from './vscodeStub';
import { PNG_BASE64 } from '../core/png';
import { convert as inProcessConvert } from '../../src/core/convert';
import { PasteLandingWatcher } from '../../src/vscode/pasteLanding';
import {
  PASTE_KIND,
  PASTE_METADATA,
  PasteAsMarkdownProvider,
} from '../../src/vscode/pasteProvider';

/** The provider is given a converter; the tests run the real one, in process. */
const convert = vi.fn(inProcessConvert);

function transfer(flavors: Record<string, string>): vscode.DataTransfer {
  return {
    get: (mime: string) => (mime in flavors ? { asString: async () => flavors[mime] } : undefined),
  } as unknown as vscode.DataTransfer;
}
const savedDoc = { uri: vscode.Uri.file('/ws/notes/doc.md') } as vscode.TextDocument;
const untitledDoc = { uri: StubUri.untitled('Untitled-1') } as unknown as vscode.TextDocument;
const pasteAs: vscode.DocumentPasteEditContext = {
  triggerKind: vscode.DocumentPasteTriggerKind.PasteAs,
  only: PASTE_KIND,
};
const automatic: vscode.DocumentPasteEditContext = {
  triggerKind: vscode.DocumentPasteTriggerKind.Automatic,
  only: undefined,
};
/** VS Code also asks for edits to fill the "Paste As…" picker, with no kind requested. */
const picker: vscode.DocumentPasteEditContext = {
  triggerKind: vscode.DocumentPasteTriggerKind.PasteAs,
  only: undefined,
};
const token = {} as vscode.CancellationToken;
const png = `data:image/png;base64,${PNG_BASE64}`;

describe('PasteAsMarkdownProvider', () => {
  let watcher: PasteLandingWatcher;
  let provider: PasteAsMarkdownProvider;
  const provide = (
    doc: vscode.TextDocument,
    flavors: Record<string, string>,
    context: vscode.DocumentPasteEditContext = pasteAs,
  ) => provider.provideDocumentPasteEdits(doc, [], transfer(flavors), context, token);

  beforeEach(() => {
    testing.reset();
    watcher = new PasteLandingWatcher();
    vi.spyOn(watcher, 'expect');
    provider = new PasteAsMarkdownProvider(watcher, (html, options) => convert(html, options));
  });
  afterEach(() => watcher.dispose());

  it('declares its kind and reads html and plain text', () => {
    expect(PASTE_KIND.value).toBe('markdown.fromHtml');
    expect(PASTE_METADATA.providedPasteEditKinds).toEqual([PASTE_KIND]);
    expect(PASTE_METADATA.pasteMimeTypes).toEqual(['text/html', 'text/plain']);
  });

  it.each([
    ['html only', { 'text/html': '<b>SENTINEL</b>' }],
    ['html + plain', { 'text/html': '<b>SENTINEL</b>', 'text/plain': 'SENTINEL' }],
    ['html + image', { 'text/html': '<b>SENTINEL</b>', 'image/png': 'x' }],
  ])('returns nothing for a normal paste (%s)', async (_name, flavors) => {
    expect(await provide(savedDoc, flavors, automatic)).toBeUndefined();
  });

  it('converts html on an explicit paste-as and yields to plain text', async () => {
    const edits = await provide(savedDoc, {
      'text/html': '<b>SENTINEL</b>',
      'text/plain': 'SENTINEL',
    });
    expect(edits).toHaveLength(1);
    expect(edits![0]!.insertText).toBe('**SENTINEL**');
    expect(edits![0]!.kind).toBe(PASTE_KIND);
    expect(edits![0]!.yieldTo).toEqual([vscode.DocumentDropOrPasteEditKind.Text]);
    expect(edits![0]!.additionalEdit).toBeUndefined();
  });

  it('falls back to the plain text, unchanged, when there is no html', async () => {
    const edits = await provide(savedDoc, { 'text/plain': 'L1\nL2' });
    expect(edits![0]!.insertText).toBe('L1\nL2');
  });

  it('returns nothing when there is neither html nor plain text', async () => {
    expect(await provide(savedDoc, { 'image/png': 'x' })).toBeUndefined();
  });

  it('creates embedded images next to the document without overwriting, and watches for the landing', async () => {
    const edits = await provide(savedDoc, { 'text/html': `<img alt="p" src="${png}">` });
    expect(edits![0]!.insertText).toBe('![p](assets/image-c414cd0e204de974.png)');
    const created = (edits![0]!.additionalEdit as unknown as WorkspaceEdit).created;
    expect(created.map((c) => c.uri.toString())).toEqual([
      'file:/ws/notes/assets/image-c414cd0e204de974.png',
    ]);
    expect(created[0]!.options.ignoreIfExists).toBe(true);
    expect(created[0]!.options.contents?.length).toBe(70);
    expect(watcher.expect).toHaveBeenCalledWith(
      savedDoc,
      '![p](assets/image-c414cd0e204de974.png)',
      { warnings: [], targets: [created[0]!.uri] },
    );
  });

  it('honors the destination setting', async () => {
    testing.configuration.set('markdownClipboard.imageDestination', '../media');
    const edits = await provide(savedDoc, { 'text/html': `<img src="${png}">` });
    expect(edits![0]!.insertText).toBe('![](../media/image-c414cd0e204de974.png)');
    const created = (edits![0]!.additionalEdit as unknown as WorkspaceEdit).created;
    expect(created[0]!.uri.toString()).toBe('file:/ws/media/image-c414cd0e204de974.png');
  });

  it('expands ${workspaceFolder} and ${documentBaseName}, linking relative to the document', async () => {
    testing.configuration.set(
      'markdownClipboard.imageDestination',
      '${workspaceFolder}/static/${documentBaseName}',
    );
    const edits = await provide(savedDoc, { 'text/html': `<img src="${png}">` });
    expect(edits![0]!.insertText).toBe('![](../static/doc/image-c414cd0e204de974.png)');
    const created = (edits![0]!.additionalEdit as unknown as WorkspaceEdit).created;
    expect(created[0]!.uri.toString()).toBe('file:/ws/static/doc/image-c414cd0e204de974.png');
  });

  it('rejects ${workspaceFolder} when the document is in no workspace folder', async () => {
    testing.workspaceFolder = undefined;
    testing.configuration.set('markdownClipboard.imageDestination', '${workspaceFolder}/static');
    const edits = await provide(savedDoc, { 'text/html': `<img src="${png}">` });
    expect(edits![0]!.insertText).toBe('![](assets/image-c414cd0e204de974.png)');
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(watcher.expect).toHaveBeenCalledWith(savedDoc, edits![0]!.insertText, {
      warnings: [
        'Paste as Markdown: cannot use "${workspaceFolder}/static" as the image destination (the document is not inside a workspace folder), so images go to "assets" instead.',
      ],
      targets: [(edits![0]!.additionalEdit as unknown as WorkspaceEdit).created[0]!.uri],
    });
  });

  it('does not read the destination for an untitled document', async () => {
    testing.configuration.set('markdownClipboard.imageDestination', '/abs');
    await provide(untitledDoc, { 'text/html': '<p>x</p>' });
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(watcher.expect).not.toHaveBeenCalled();
  });

  it('rejects an absolute destination: uses the default and warns', async () => {
    testing.configuration.set('markdownClipboard.imageDestination', 'C:\\img');
    const edits = await provide(savedDoc, { 'text/html': `<img src="${png}">` });
    expect(edits![0]!.insertText).toBe('![](assets/image-c414cd0e204de974.png)');
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    testing.fireDidChangeTextDocument(savedDoc, [edits![0]!.insertText as string]);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Paste as Markdown: cannot use "C:\\img" as the image destination (it is an absolute path), so images go to "assets" instead.',
    );
  });

  it('drops embedded images in an untitled document with one warning, and pastes the rest', async () => {
    const edits = await provide(untitledDoc, {
      'text/html': `<p>text<img src="${png}"><img src="cid:1"></p>`,
    });
    expect(edits![0]!.insertText).toBe('text');
    expect(edits![0]!.additionalEdit).toBeUndefined();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();

    testing.fireDidChangeTextDocument(untitledDoc, ['text']);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Paste as Markdown: 2 images were not pasted (1 embedded image that cannot be saved because the document has no folder, 1 from a source that cannot be linked).',
    );
  });

  it('shows an error and returns no edit when conversion throws', async () => {
    convert.mockRejectedValueOnce(new Error('boom'));
    expect(await provide(savedDoc, { 'text/html': '<p>x</p>' })).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Paste as Markdown failed: boom');
  });

  it('shows an error when the clipboard cannot be read', async () => {
    const unreadable = {
      get: () => ({ asString: async () => Promise.reject(new Error('gone')) }),
    } as unknown as vscode.DataTransfer;
    expect(
      await provider.provideDocumentPasteEdits(savedDoc, [], unreadable, pasteAs, token),
    ).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Paste as Markdown failed: gone');
  });

  it('stays silent when an option the picker only lists cannot be built', async () => {
    convert.mockRejectedValueOnce(new Error('boom'));
    expect(await provide(savedDoc, { 'text/html': '<p>x</p>' }, picker)).toBeUndefined();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['the picker lists options', picker],
    ['the command asked for our kind', pasteAs],
  ])('says nothing until the edit lands, whether %s', async (_name, context) => {
    const warning =
      'Paste as Markdown: 1 image was not pasted (1 embedded image that cannot be saved because the document has no folder).';
    const edits = await provide(
      untitledDoc,
      { 'text/html': `<p>text<img src="${png}"></p>` },
      context,
    );
    expect(edits![0]!.insertText).toBe('text');
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(watcher.expect).toHaveBeenCalledWith(untitledDoc, 'text', {
      warnings: [warning],
      targets: [],
    });

    testing.fireDidChangeTextDocument(untitledDoc, ['text']);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(warning);
  });

  it('warns at once for a paste that inserts nothing the command could watch for', async () => {
    await provide(untitledDoc, { 'text/html': `<p><img src="${png}"></p>` });
    expect(watcher.expect).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Paste as Markdown: 1 image was not pasted (1 embedded image that cannot be saved because the document has no folder).',
    );
  });

  it('stays silent for a paste that inserts nothing while the picker lists options', async () => {
    await provide(untitledDoc, { 'text/html': `<p><img src="${png}"></p>` }, picker);
    expect(watcher.expect).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });
});
