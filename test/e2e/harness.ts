import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
export const PNG_DATA_URI = `data:image/png;base64,${PNG.toString('base64')}`;
export const PASTE_AS_MARKDOWN = 'markdownClipboard.pasteAsMarkdown';
export const NORMAL_PASTE = 'editor.action.clipboardPasteAction';

export const workspaceRoot = (): string => vscode.workspace.workspaceFolders![0]!.uri.fsPath;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(
  condition: () => boolean,
  what: string,
  timeoutMs = 8000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

/** Negative assertions need time for a wrong edit to land before we look. */
export const settle = (): Promise<void> => sleep(1500);

export async function openFile(
  relativePath: string,
  content: string,
  selections: vscode.Selection[],
): Promise<vscode.TextEditor> {
  const file = path.join(workspaceRoot(), relativePath);
  // every test owns the first folder of its path; start from nothing so a retried test is not
  // fooled by what its first attempt left behind
  const testFolder = relativePath.split('/')[0];
  if (testFolder && testFolder !== relativePath) {
    fs.rmSync(path.join(workspaceRoot(), testFolder), { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  const editor = await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(file),
  );
  editor.selections = selections;
  return editor;
}

export const cursor = (line: number, character: number): vscode.Selection =>
  new vscode.Selection(line, character, line, character);

export async function closeAll(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
}

export interface MessageSpy {
  warnings: string[];
  errors: string[];
  restore(): void;
}

/** VS Code has no API to read notifications; this is the accepted stand-in for "a message is shown". */
export function spyOnMessages(): MessageSpy {
  const window = vscode.window as unknown as Record<string, unknown>;
  const original = { warn: window['showWarningMessage'], error: window['showErrorMessage'] };
  const spy: MessageSpy = {
    warnings: [],
    errors: [],
    restore: () => {
      window['showWarningMessage'] = original.warn;
      window['showErrorMessage'] = original.error;
    },
  };
  window['showWarningMessage'] = async (message: string) => void spy.warnings.push(message);
  window['showErrorMessage'] = async (message: string) => void spy.errors.push(message);
  return spy;
}

export async function setDestination(value: string | undefined): Promise<void> {
  await vscode.workspace
    .getConfiguration('markdownClipboard')
    .update('imageDestination', value, vscode.ConfigurationTarget.Workspace);
}
