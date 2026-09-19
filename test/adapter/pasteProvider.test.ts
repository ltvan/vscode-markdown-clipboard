import * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testing, Uri as StubUri, type WorkspaceEdit } from './vscodeStub';
import { PNG_BASE64 } from '../core/png';
import { ImageVerifier } from '../../src/vscode/imageVerifier';
import {
  PASTE_KIND,
  PASTE_METADATA,
  PasteAsMarkdownProvider,
} from '../../src/vscode/pasteProvider';

const convert = vi.hoisted(() => vi.fn());
vi.mock('../../src/core/convert', async (original) => {
  const actual = await original<typeof import('../../src/core/convert')>();
  convert.mockImplementation(actual.convert);
  return { convert };
});

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
const token = {} as vscode.CancellationToken;
const png = `data:image/png;base64,${PNG_BASE64}`;

describe('PasteAsMarkdownProvider', () => {
  let verifier: ImageVerifier;
  let provider: PasteAsMarkdownProvider;
  const provide = (
    doc: vscode.TextDocument,
    flavors: Record<string, string>,
    context: vscode.DocumentPasteEditContext = pasteAs,
  ) => provider.provideDocumentPasteEdits(doc, [], transfer(flavors), context, token);

  beforeEach(() => {
    testing.reset();
    verifier = new ImageVerifier();
    vi.spyOn(verifier, 'expect');
    provider = new PasteAsMarkdownProvider(verifier);
  });

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

  it('creates embedded images next to the document without overwriting, and arms the verifier', async () => {
    const edits = await provide(savedDoc, { 'text/html': `<img alt="p" src="${png}">` });
    expect(edits![0]!.insertText).toBe('![p](assets/image-c414cd0e.png)');
    const created = (edits![0]!.additionalEdit as unknown as WorkspaceEdit).created;
    expect(created.map((c) => c.uri.toString())).toEqual([
      'file:/ws/notes/assets/image-c414cd0e.png',
    ]);
    expect(created[0]!.options.ignoreIfExists).toBe(true);
    expect(created[0]!.options.contents?.length).toBe(70);
    expect(verifier.expect).toHaveBeenCalledWith(savedDoc, '![p](assets/image-c414cd0e.png)', [
      created[0]!.uri,
    ]);
  });

  it('honors the destination setting', async () => {
    testing.configuration.set('markdownClipboard.imageDestination', '../media');
    const edits = await provide(savedDoc, { 'text/html': `<img src="${png}">` });
    expect(edits![0]!.insertText).toBe('![](../media/image-c414cd0e.png)');
    const created = (edits![0]!.additionalEdit as unknown as WorkspaceEdit).created;
    expect(created[0]!.uri.toString()).toBe('file:/ws/media/image-c414cd0e.png');
  });

  it('expands ${workspaceFolder} and ${documentBaseName}, linking relative to the document', async () => {
    testing.configuration.set(
      'markdownClipboard.imageDestination',
      '${workspaceFolder}/static/${documentBaseName}',
    );
    const edits = await provide(savedDoc, { 'text/html': `<img src="${png}">` });
    expect(edits![0]!.insertText).toBe('![](../static/doc/image-c414cd0e.png)');
    const created = (edits![0]!.additionalEdit as unknown as WorkspaceEdit).created;
    expect(created[0]!.uri.toString()).toBe('file:/ws/static/doc/image-c414cd0e.png');
  });

  it('rejects ${workspaceFolder} when the document is in no workspace folder', async () => {
    testing.workspaceFolder = undefined;
    testing.configuration.set('markdownClipboard.imageDestination', '${workspaceFolder}/static');
    const edits = await provide(savedDoc, { 'text/html': `<img src="${png}">` });
    expect(edits![0]!.insertText).toBe('![](assets/image-c414cd0e.png)');
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Paste as Markdown: cannot use "${workspaceFolder}/static" as the image destination (the document is not inside a workspace folder), so images go to "assets" instead.',
    );
  });

  it('does not read the destination for an untitled document', async () => {
    testing.configuration.set('markdownClipboard.imageDestination', '/abs');
    await provide(untitledDoc, { 'text/html': '<p>x</p>' });
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('rejects an absolute destination: uses the default and warns', async () => {
    testing.configuration.set('markdownClipboard.imageDestination', 'C:\\img');
    const edits = await provide(savedDoc, { 'text/html': `<img src="${png}">` });
    expect(edits![0]!.insertText).toBe('![](assets/image-c414cd0e.png)');
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
    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Paste as Markdown: 2 images were not pasted (1 embedded image that cannot be saved because the document has no folder, 1 from a source that cannot be linked).',
    );
    expect(verifier.expect).not.toHaveBeenCalled();
  });

  it('shows an error and returns no edit when conversion throws', async () => {
    convert.mockRejectedValueOnce(new Error('boom'));
    expect(await provide(savedDoc, { 'text/html': '<p>x</p>' })).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Paste as Markdown failed: boom');
  });
});
