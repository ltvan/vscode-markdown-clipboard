import * as vscode from 'vscode';
import { ImageVerifier } from './vscode/imageVerifier';
import { pasteAsMarkdown } from './vscode/pasteCommand';
import { PASTE_METADATA, PasteAsMarkdownProvider } from './vscode/pasteProvider';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerDocumentPasteEditProvider(
      { language: 'markdown' },
      new PasteAsMarkdownProvider(new ImageVerifier()),
      PASTE_METADATA,
    ),
    vscode.commands.registerCommand('markdownClipboard.pasteAsMarkdown', pasteAsMarkdown),
  );
}
