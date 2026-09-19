import * as vscode from 'vscode';
import { convertInBackground } from './vscode/backgroundConvert';
import { pasteAsMarkdown } from './vscode/pasteCommand';
import { PasteLandingWatcher } from './vscode/pasteLanding';
import { PASTE_METADATA, PasteAsMarkdownProvider } from './vscode/pasteProvider';

export function activate(context: vscode.ExtensionContext): void {
  const watcher = new PasteLandingWatcher();
  context.subscriptions.push(
    watcher,
    vscode.languages.registerDocumentPasteEditProvider(
      { language: 'markdown' },
      new PasteAsMarkdownProvider(watcher, convertInBackground),
      PASTE_METADATA,
    ),
    vscode.commands.registerCommand('markdownClipboard.pasteAsMarkdown', pasteAsMarkdown),
  );
}
