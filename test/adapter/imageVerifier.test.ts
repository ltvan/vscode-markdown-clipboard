import * as vscode from 'vscode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testing } from './vscodeStub';
import { ImageVerifier } from '../../src/vscode/imageVerifier';

const doc = { uri: vscode.Uri.file('/ws/doc.md') } as vscode.TextDocument;
const target = vscode.Uri.file('/ws/assets/image-c414cd0e204de974.png');
const options = { intervalMs: 10, attempts: 3, armedMs: 1000 };

describe('ImageVerifier', () => {
  beforeEach(() => {
    testing.reset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('stays silent when the files exist after the paste lands', async () => {
    new ImageVerifier(options).expect(doc, 'TEXT', [target]);
    testing.existingFiles.add(target.toString());
    testing.fireDidChangeTextDocument(doc, ['TEXT']);
    await vi.runAllTimersAsync();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(testing.listenerCount()).toBe(0);
  });

  it('names the missing images and suggests undo when they never appear', async () => {
    new ImageVerifier(options).expect(doc, 'TEXT', [target]);
    testing.fireDidChangeTextDocument(doc, ['TEXT']);
    await vi.runAllTimersAsync();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Paste as Markdown: could not save image-c414cd0e204de974.png. The text was pasted; undo to revert it.',
    );
  });

  it('matches the inserted text regardless of line endings, once, even with several cursors', async () => {
    new ImageVerifier(options).expect(doc, 'A\nB', [target]);
    testing.fireDidChangeTextDocument(doc, ['A\r\nB', 'A\r\nB']);
    await vi.runAllTimersAsync();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
  });

  it('ignores other edits and other documents, and disarms itself if the edit is never applied', async () => {
    new ImageVerifier(options).expect(doc, 'TEXT', [target]);
    testing.fireDidChangeTextDocument(doc, ['typing']);
    testing.fireDidChangeTextDocument({}, ['TEXT']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(testing.listenerCount()).toBe(0);
  });
});
