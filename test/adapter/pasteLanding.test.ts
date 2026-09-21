import * as vscode from 'vscode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testing } from './vscodeStub';
import { PasteLandingWatcher } from '../../src/vscode/pasteLanding';

const doc = { uri: vscode.Uri.file('/ws/doc.md') } as vscode.TextDocument;
const target = vscode.Uri.file('/ws/assets/image-c414cd0e204de974.png');
const options = { intervalMs: 10, attempts: 3, armedMs: 1000 };
const nothing = { warnings: [], targets: [] };

describe('PasteLandingWatcher', () => {
  beforeEach(() => {
    testing.reset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('stays silent when the files exist after the paste lands', async () => {
    new PasteLandingWatcher(options).expect(doc, 'TEXT', { ...nothing, targets: [target] });
    testing.existingFiles.add(target.toString());
    testing.fireDidChangeTextDocument(doc, ['TEXT']);
    await vi.runAllTimersAsync();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(testing.listenerCount()).toBe(0);
  });

  it('names the missing images and suggests undo when they never appear', async () => {
    new PasteLandingWatcher(options).expect(doc, 'TEXT', { ...nothing, targets: [target] });
    testing.fireDidChangeTextDocument(doc, ['TEXT']);
    await vi.runAllTimersAsync();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Paste as Markdown: could not save image-c414cd0e204de974.png. The text was pasted; undo to revert it.',
    );
  });

  it('matches the inserted text regardless of line endings, once, even with several cursors', async () => {
    new PasteLandingWatcher(options).expect(doc, 'A\nB', { ...nothing, targets: [target] });
    testing.fireDidChangeTextDocument(doc, ['A\r\nB', 'A\r\nB']);
    await vi.runAllTimersAsync();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
  });

  it('shows every warning as the paste lands, before the files are verified', async () => {
    new PasteLandingWatcher(options).expect(doc, 'TEXT', {
      warnings: ['first', 'second'],
      targets: [target],
    });
    testing.fireDidChangeTextDocument(doc, ['TEXT']);
    // no timer has run yet: the warnings do not wait for the file poll
    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(2);
    expect(vscode.window.showWarningMessage).toHaveBeenNthCalledWith(1, 'first');
    expect(vscode.window.showWarningMessage).toHaveBeenNthCalledWith(2, 'second');
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
  });

  it('warns without polling when the paste saves no file', async () => {
    new PasteLandingWatcher(options).expect(doc, 'TEXT', { warnings: ['dropped'], targets: [] });
    testing.fireDidChangeTextDocument(doc, ['TEXT']);
    await vi.runAllTimersAsync();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('dropped');
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(testing.listenerCount()).toBe(0);
  });

  it('says nothing at all when the edit is never applied', async () => {
    new PasteLandingWatcher(options).expect(doc, 'TEXT', {
      warnings: ['dropped'],
      targets: [target],
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(testing.listenerCount()).toBe(0);
  });

  it('keeps one pending check per document and text, however often it is armed', async () => {
    const watcher = new PasteLandingWatcher(options);
    const effects = { warnings: ['dropped'], targets: [target] };
    for (let arming = 0; arming < 4; arming++) {
      watcher.expect(doc, 'TEXT', effects);
      expect(testing.listenerCount()).toBe(1);
    }
    testing.fireDidChangeTextDocument(doc, ['TEXT']);
    expect(testing.listenerCount()).toBe(0);
    await vi.runAllTimersAsync();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
  });

  it('disposes cleanly however often the same paste was armed', () => {
    const watcher = new PasteLandingWatcher(options);
    for (let arming = 0; arming < 3; arming++) {
      watcher.expect(doc, 'TEXT', { warnings: ['dropped'], targets: [] });
    }
    watcher.dispose();
    expect(testing.listenerCount()).toBe(0);
  });

  it('disarms everything when disposed', async () => {
    const watcher = new PasteLandingWatcher(options);
    watcher.expect(doc, 'ONE', { warnings: ['a'], targets: [] });
    watcher.expect(doc, 'TWO', { warnings: ['b'], targets: [] });
    expect(testing.listenerCount()).toBe(2);
    watcher.dispose();
    expect(testing.listenerCount()).toBe(0);
    testing.fireDidChangeTextDocument(doc, ['ONE']);
    await vi.runAllTimersAsync();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('stops reporting once disposed mid-poll', async () => {
    const watcher = new PasteLandingWatcher(options);
    watcher.expect(doc, 'TEXT', { ...nothing, targets: [target] });
    testing.fireDidChangeTextDocument(doc, ['TEXT']);
    // let one poll elapse with the file still missing, then dispose mid-poll
    await vi.advanceTimersByTimeAsync(options.intervalMs);
    watcher.dispose();
    await vi.runAllTimersAsync();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('ignores other edits and other documents, and disarms itself if the edit is never applied', async () => {
    new PasteLandingWatcher(options).expect(doc, 'TEXT', { ...nothing, targets: [target] });
    testing.fireDidChangeTextDocument(doc, ['typing']);
    testing.fireDidChangeTextDocument({}, ['TEXT']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(testing.listenerCount()).toBe(0);
  });
});
