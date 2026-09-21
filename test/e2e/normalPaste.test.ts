import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { seedClipboard } from './clipboard';
import {
  closeAll,
  cursor,
  NORMAL_PASTE,
  openFile,
  PNG,
  settle,
  waitFor,
  workspaceRoot,
} from './harness';

const paste = () => vscode.commands.executeCommand(NORMAL_PASTE);

suite('Normal paste is never converted (AC2)', () => {
  teardown(closeAll);

  test('HTML + plain text: pastes exactly the plain text', async () => {
    const editor = await openFile('ac2/plain.md', 'A\n', [cursor(0, 1)]);
    seedClipboard({ html: '<b>SENTINEL</b>', text: 'PLAIN' });
    await paste();
    await waitFor(() => editor.document.getText() === 'APLAIN\n', 'plain paste');
  });

  test('HTML only: no converted text appears', async () => {
    const editor = await openFile('ac2/html.md', 'A\n', [cursor(0, 1)]);
    seedClipboard({ html: '<b>SENTINEL</b>' });
    await paste();
    await settle();
    assert.ok(!editor.document.getText().includes('**SENTINEL**'));
  });

  test('HTML + image: no converted text appears', async () => {
    const editor = await openFile('ac2/image.md', 'A\n', [cursor(0, 1)]);
    seedClipboard({ html: '<b>SENTINEL</b>', png: PNG });
    await paste();
    await settle();
    assert.ok(!editor.document.getText().includes('**SENTINEL**'));
  });
});

suite('Raw image paste stays with VS Code (AC11)', () => {
  teardown(closeAll);

  test('a normal paste of an image-only clipboard inserts an image link and saves the image', async () => {
    const editor = await openFile('ac11-normal/doc.md', '', [cursor(0, 0)]);
    seedClipboard({ png: PNG });
    await paste();
    await waitFor(
      () => /!\[[^\]]*\]\([^)]+\.png\)/.test(editor.document.getText()),
      'built-in image link',
    );
    const folder = path.join(workspaceRoot(), 'ac11-normal');
    await waitFor(
      () => fs.readdirSync(folder).some((name) => name.endsWith('.png')),
      'built-in image file',
    );
  });
});
