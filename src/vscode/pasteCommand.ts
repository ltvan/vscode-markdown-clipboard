import * as vscode from 'vscode';
import { PASTE_KIND } from './pasteProvider';

export async function pasteAsMarkdown(): Promise<void> {
  if (vscode.window.activeTextEditor?.document.languageId !== 'markdown') return;
  await vscode.commands.executeCommand('editor.action.pasteAs', { kind: PASTE_KIND.value });
}
