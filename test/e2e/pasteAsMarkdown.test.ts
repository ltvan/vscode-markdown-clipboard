import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { seedClipboard } from './clipboard';
import {
  closeAll,
  cursor,
  type MessageSpy,
  openFile,
  PASTE_AS_MARKDOWN,
  PNG,
  PNG_DATA_URI,
  setDestination,
  settle,
  spyOnMessages,
  waitFor,
  workspaceRoot,
} from './harness';

const run = () => vscode.commands.executeCommand(PASTE_AS_MARKDOWN);
const exists = (...segments: string[]) => fs.existsSync(path.join(workspaceRoot(), ...segments));

suite('Paste as Markdown', () => {
  let messages: MessageSpy;
  setup(() => {
    messages = spyOnMessages();
  });
  teardown(async () => {
    messages.restore();
    await setDestination(undefined);
    await closeAll();
  });

  test('AC1: inserts the converted Markdown at the cursor', async () => {
    const editor = await openFile('ac1/cursor.md', 'A\nB\n', [cursor(0, 1)]);
    seedClipboard({ html: '<b>SENTINEL</b>', text: 'SENTINEL' });
    await run();
    await waitFor(() => editor.document.getText() === 'A**SENTINEL**\nB\n', 'converted text');
  });

  test('AC1: replaces the selection', async () => {
    const editor = await openFile('ac1/selection.md', 'A old B\n', [
      new vscode.Selection(0, 2, 0, 5),
    ]);
    seedClipboard({ html: '<i>new</i>', text: 'new' });
    await run();
    await waitFor(() => editor.document.getText() === 'A _new_ B\n', 'replaced selection');
  });

  test('AC1: inserts at every cursor', async () => {
    const editor = await openFile('ac1/multi.md', 'A\nB\n', [cursor(0, 1), cursor(1, 1)]);
    seedClipboard({ html: '<b>X</b>', text: 'X' });
    await run();
    await waitFor(() => editor.document.getText() === 'A**X**\nB**X**\n', 'text at both cursors');
  });

  test('AC4: keeps a remote image as a link and creates no file', async () => {
    const editor = await openFile('ac4/doc.md', '', [cursor(0, 0)]);
    seedClipboard({ html: '<img alt="x" src="https://example.com/a.png">', text: 'x' });
    await run();
    await waitFor(
      () => editor.document.getText() === '![x](https://example.com/a.png)',
      'image link',
    );
    assert.deepStrictEqual(fs.readdirSync(path.join(workspaceRoot(), 'ac4')), ['doc.md']);
  });

  test('AC5: saves an embedded image under assets/ and links it; pasting again reuses the file', async () => {
    const editor = await openFile('ac5/doc.md', '', [cursor(0, 0)]);
    seedClipboard({ html: `<img alt="p" src="${PNG_DATA_URI}">`, text: 'p' });
    await run();
    await waitFor(() => exists('ac5', 'assets', 'image-c414cd0e204de974.png'), 'image file');
    assert.strictEqual(editor.document.getText(), '![p](assets/image-c414cd0e204de974.png)');
    assert.ok(
      fs
        .readFileSync(path.join(workspaceRoot(), 'ac5', 'assets', 'image-c414cd0e204de974.png'))
        .equals(PNG),
    );

    await run();
    await waitFor(
      () => editor.document.getText().split('image-c414cd0e204de974.png').length === 3,
      'second paste',
    );
    assert.deepStrictEqual(fs.readdirSync(path.join(workspaceRoot(), 'ac5', 'assets')), [
      'image-c414cd0e204de974.png',
    ]);
    assert.deepStrictEqual(messages.errors, []);
  });

  test('AC6: honors markdownClipboard.imageDestination', async () => {
    await setDestination('media/img');
    const editor = await openFile('ac6/doc.md', '', [cursor(0, 0)]);
    seedClipboard({ html: `<img src="${PNG_DATA_URI}">`, text: 'p' });
    await run();
    await waitFor(
      () => exists('ac6', 'media', 'img', 'image-c414cd0e204de974.png'),
      'image in media/img',
    );
    assert.strictEqual(editor.document.getText(), '![](media/img/image-c414cd0e204de974.png)');
  });

  test('AC6: ${workspaceFolder} puts images under the workspace root and links relative to the document', async () => {
    await setDestination('${workspaceFolder}/ac6-root/${documentBaseName}');
    const editor = await openFile('ac6vars/guide/intro.md', '', [cursor(0, 0)]);
    seedClipboard({ html: `<img src="${PNG_DATA_URI}">`, text: 'p' });
    await run();
    await waitFor(
      () => exists('ac6-root', 'intro', 'image-c414cd0e204de974.png'),
      'image under the workspace root',
    );
    assert.strictEqual(
      editor.document.getText(),
      '![](../../ac6-root/intro/image-c414cd0e204de974.png)',
    );
  });

  test('AC6: rejects an absolute destination with a warning and uses assets/', async () => {
    await setDestination('/absolute/place');
    await openFile('ac6abs/doc.md', '', [cursor(0, 0)]);
    seedClipboard({ html: `<img src="${PNG_DATA_URI}">`, text: 'p' });
    await run();
    await waitFor(
      () => exists('ac6abs', 'assets', 'image-c414cd0e204de974.png'),
      'image in assets',
    );
    assert.strictEqual(messages.warnings.length, 1);
    assert.match(messages.warnings[0]!, /absolute path/);
  });

  test('AC7: in an untitled document, drops embedded images with one warning and pastes the rest', async () => {
    const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: '' });
    await vscode.window.showTextDocument(document);
    seedClipboard({
      html: `<p>kept<img src="${PNG_DATA_URI}"><img src="file:///C:/t/a.png"></p>`,
      text: 'kept',
    });
    await run();
    await waitFor(() => document.getText() === 'kept', 'text without images');
    assert.strictEqual(messages.warnings.length, 1);
    assert.match(messages.warnings[0]!, /2 images were not pasted/);
  });

  test('AC8: with no HTML, pastes the plain text unchanged, in full at each cursor', async () => {
    const editor = await openFile('ac8/plain.md', 'A\nB\n', [cursor(0, 1), cursor(1, 1)]);
    seedClipboard({ text: '*not* converted' });
    await run();
    await waitFor(
      () => editor.document.getText() === 'A*not* converted\nB*not* converted\n',
      'plain text',
    );
  });

  test('AC9(b): when the image cannot be saved, pastes the text, reports the image, and one undo reverts', async function () {
    if (process.platform === 'win32') this.skip(); // chmod cannot make a folder read-only on Windows
    const readOnly = path.join(workspaceRoot(), 'ac9', 'ro');
    fs.mkdirSync(readOnly, { recursive: true });
    fs.chmodSync(readOnly, 0o555);
    try {
      await setDestination('ro');
      const editor = await openFile('ac9/doc.md', '', [cursor(0, 0)]);
      seedClipboard({ html: `<img alt="p" src="${PNG_DATA_URI}">`, text: 'p' });
      await run();
      // the extension polls ~3 s for the file before it reports; slow machines need headroom
      await waitFor(() => messages.errors.length === 1, 'error message', 20_000);
      assert.match(messages.errors[0]!, /could not save image-c414cd0e204de974\.png/);
      assert.strictEqual(editor.document.getText(), '![p](ro/image-c414cd0e204de974.png)');
      await vscode.commands.executeCommand('undo');
      await waitFor(() => editor.document.getText() === '', 'undo');
    } finally {
      fs.chmodSync(readOnly, 0o755);
    }
  });

  test('AC10(b): does nothing outside Markdown documents', async () => {
    const editor = await openFile('ac10/note.txt', 'A\n', [cursor(0, 1)]);
    seedClipboard({ html: '<b>SENTINEL</b>', text: 'SENTINEL' });
    await run();
    await settle();
    assert.strictEqual(editor.document.getText(), 'A\n');
    assert.deepStrictEqual(fs.readdirSync(path.join(workspaceRoot(), 'ac10')), ['note.txt']);
  });

  test('converts a clipboard far larger than a hand-written paste, in the background worker', async function () {
    this.timeout(60_000);
    const paragraphs = 40_000;
    const editor = await openFile('big/doc.md', '', [cursor(0, 0)]);
    seedClipboard({ html: '<p>x</p>'.repeat(paragraphs), text: 'x' });
    await run();
    // one "x" line per paragraph, separated by a blank line
    await waitFor(
      () => editor.document.lineCount === paragraphs * 2 - 1,
      'the whole payload',
      40_000,
    );
    // a new empty file gets the platform's line ending (CRLF on Windows)
    const text = editor.document.getText().replace(/\r\n/g, '\n');
    assert.strictEqual(text.length, paragraphs * 3 - 2);
    assert.deepStrictEqual(messages.errors, []);
  });

  test('AC11: with only a raw image on the clipboard, inserts nothing and creates no file', async () => {
    const editor = await openFile('ac11/doc.md', 'A\n', [cursor(0, 1)]);
    seedClipboard({ png: PNG });
    await run();
    await settle();
    assert.strictEqual(editor.document.getText(), 'A\n');
    assert.deepStrictEqual(fs.readdirSync(path.join(workspaceRoot(), 'ac11')), ['doc.md']);
  });
});
