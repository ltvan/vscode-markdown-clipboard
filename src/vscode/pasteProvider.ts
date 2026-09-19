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
  'invalid-character': 'it contains a control character',
};

/** Carries what must happen only if this edit is the one the user picks. */
export class MarkdownPasteEdit extends vscode.DocumentPasteEdit {
  readonly warnings: string[] = [];
  verify?: { document: vscode.TextDocument; insertedText: string; targets: vscode.Uri[] };
}

export class PasteAsMarkdownProvider implements vscode.DocumentPasteEditProvider<MarkdownPasteEdit> {
  constructor(private readonly verifier: ImageVerifier) {}

  /**
   * Side-effect free: VS Code also calls this to fill the "Paste As…" picker, where
   * our option is merely listed and usually never chosen.
   */
  async provideDocumentPasteEdits(
    document: vscode.TextDocument,
    _ranges: readonly vscode.Range[],
    dataTransfer: vscode.DataTransfer,
    context: vscode.DocumentPasteEditContext,
    _token: vscode.CancellationToken,
  ): Promise<MarkdownPasteEdit[] | undefined> {
    // a normal paste must never be altered, whatever is on the clipboard
    if (context.triggerKind !== vscode.DocumentPasteTriggerKind.PasteAs) return undefined;

    try {
      const html = await dataTransfer.get('text/html')?.asString();
      if (!html) {
        const plain = await dataTransfer.get('text/plain')?.asString();
        return plain ? [this.edit(plain)] : undefined;
      }

      const canSaveImages = document.uri.scheme !== 'untitled';
      const settings: Settings = canSaveImages
        ? readSettings(document)
        : { imageDestination: DEFAULT_IMAGE_DESTINATION };

      const result = await convert(html, {
        imageDestination: settings.imageDestination,
        canSaveImages,
      });

      const edit = this.edit(result.markdown);
      if (settings.rejected) {
        edit.warnings.push(
          `Paste as Markdown: cannot use "${settings.rejected.configured}" as the image destination (${REJECTION_TEXT[settings.rejected.reason]}), so images go to "${DEFAULT_IMAGE_DESTINATION}" instead.`,
        );
      }
      const warning = summarizeDropped(result.dropped);
      if (warning) edit.warnings.push(warning);

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
        edit.verify = { document, insertedText: result.markdown, targets };
      }
      return [edit];
    } catch (error) {
      // an option the picker only lists is simply not offered; the user asked for nothing
      if (context.only?.value !== PASTE_KIND.value) return undefined;
      const reason = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Paste as Markdown failed: ${reason}`);
      return undefined;
    }
  }

  /** VS Code calls this once, on the edit it is about to apply. */
  resolveDocumentPasteEdit(
    edit: MarkdownPasteEdit,
    _token: vscode.CancellationToken,
  ): MarkdownPasteEdit {
    for (const warning of edit.warnings) void vscode.window.showWarningMessage(warning);
    if (edit.verify) {
      this.verifier.expect(edit.verify.document, edit.verify.insertedText, edit.verify.targets);
    }
    return edit;
  }

  private edit(text: string): MarkdownPasteEdit {
    const edit = new MarkdownPasteEdit(text, TITLE, PASTE_KIND);
    edit.yieldTo = [vscode.DocumentDropOrPasteEditKind.Text];
    return edit;
  }
}
