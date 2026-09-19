import * as vscode from 'vscode';
import { ImageVerifier } from './vscode/imageVerifier';
import { pasteAsMarkdown } from './vscode/pasteCommand';
import { PASTE_METADATA, PasteAsMarkdownProvider } from './vscode/pasteProvider';

export function activate(context: vscode.ExtensionContext): void {
  const verifier = new ImageVerifier();
  context.subscriptions.push(
    verifier,
    vscode.languages.registerDocumentPasteEditProvider(
      { language: 'markdown' },
      new PasteAsMarkdownProvider(verifier),
      PASTE_METADATA,
    ),
    vscode.commands.registerCommand('markdownClipboard.pasteAsMarkdown', pasteAsMarkdown),
  );
}
