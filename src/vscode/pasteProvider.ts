import * as vscode from 'vscode';
import { convert } from '../core/convert';
import { summarizeDropped } from '../core/dropped';
import { imageTargetSegments } from '../core/paths';
import type { ImageVerifier } from './imageVerifier';
import type { DestinationFailure } from '../core/paths';
import { DEFAULT_IMAGE_DESTINATION, readSettings, type Settings } from './settings';

export const PASTE_KIND = vscode.DocumentDropOrPasteEditKind.Empty.append('markdown', 'fromHtml');

export const PASTE_METADATA: vscode.DocumentPasteProviderMetadata = {
  providedPasteEditKinds: [PASTE_KIND],
  pasteMimeTypes: ['text/html', 'text/plain'],
};

const TITLE = 'Paste as Markdown';

const REJECTION_TEXT: Record<DestinationFailure, string> = {
  absolute: 'it is an absolute path',
  'unknown-variable': 'it uses an unknown variable',
  'misplaced-variable': '${workspaceFolder} and ${documentDirName} are only allowed at the start',
  'no-workspace': 'the document is not inside a workspace folder',
};

export class PasteAsMarkdownProvider implements vscode.DocumentPasteEditProvider {
  constructor(private readonly verifier: ImageVerifier) {}

  async provideDocumentPasteEdits(
    document: vscode.TextDocument,
    _ranges: readonly vscode.Range[],
    dataTransfer: vscode.DataTransfer,
    context: vscode.DocumentPasteEditContext,
    _token: vscode.CancellationToken,
  ): Promise<vscode.DocumentPasteEdit[] | undefined> {
    // a normal paste must never be altered, whatever is on the clipboard
    if (context.triggerKind !== vscode.DocumentPasteTriggerKind.PasteAs) return undefined;

    const html = await dataTransfer.get('text/html')?.asString();
    if (!html) {
      const plain = await dataTransfer.get('text/plain')?.asString();
      return plain ? [this.edit(plain)] : undefined;
    }

    const canSaveImages = document.uri.scheme !== 'untitled';
    const settings: Settings = canSaveImages
      ? readSettings(document)
      : { imageDestination: DEFAULT_IMAGE_DESTINATION };
    if (settings.rejected) {
      void vscode.window.showWarningMessage(
        `Paste as Markdown: cannot use "${settings.rejected.configured}" as the image destination (${REJECTION_TEXT[settings.rejected.reason]}), so images go to "${DEFAULT_IMAGE_DESTINATION}" instead.`,
      );
    }

    let result;
    try {
      result = await convert(html, {
        imageDestination: settings.imageDestination,
        canSaveImages,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Paste as Markdown failed: ${reason}`);
      return undefined;
    }

    const warning = summarizeDropped(result.dropped);
    if (warning) void vscode.window.showWarningMessage(warning);

    const edit = this.edit(result.markdown);
    if (result.images.length > 0) {
      const files = new vscode.WorkspaceEdit();
      const targets = result.images.map((image) => {
        const target = vscode.Uri.joinPath(
          document.uri,
          '..',
          ...imageTargetSegments(settings.imageDestination, image.fileName),
        );
        files.createFile(target, { ignoreIfExists: true, contents: image.bytes });
        return target;
      });
      edit.additionalEdit = files;
      this.verifier.expect(document, result.markdown, targets);
    }
    return [edit];
  }

  private edit(text: string): vscode.DocumentPasteEdit {
    const edit = new vscode.DocumentPasteEdit(text, TITLE, PASTE_KIND);
    edit.yieldTo = [vscode.DocumentDropOrPasteEditKind.Text];
    return edit;
  }
}
