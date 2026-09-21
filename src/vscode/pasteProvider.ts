import * as vscode from 'vscode';
import { summarizeDropped } from '../core/dropped';
import { imageTargetSegments } from '../core/paths';
import type { PasteLandingWatcher } from './pasteLanding';
import type { DestinationFailure } from '../core/paths';
import type { ConvertOptions, ConvertResult } from '../core/types';
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

/** Converts the clipboard's HTML, or yields nothing when the paste was cancelled. */
export type Converter = (
  html: string,
  options: ConvertOptions,
  token: vscode.CancellationToken,
) => Promise<ConvertResult | undefined>;

/** True for the explicit command, false while the picker merely lists the options. */
const isRequested = (context: vscode.DocumentPasteEditContext): boolean =>
  context.only?.value === PASTE_KIND.value;

export class PasteAsMarkdownProvider implements vscode.DocumentPasteEditProvider {
  constructor(
    private readonly watcher: PasteLandingWatcher,
    private readonly convert: Converter,
  ) {}

  /**
   * Shows nothing itself: VS Code also calls this to fill the "Paste As…" picker, where
   * our option is merely listed and usually never chosen. What the user should see is
   * handed to the watcher, which says it when the edit actually lands.
   */
  async provideDocumentPasteEdits(
    document: vscode.TextDocument,
    _ranges: readonly vscode.Range[],
    dataTransfer: vscode.DataTransfer,
    context: vscode.DocumentPasteEditContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.DocumentPasteEdit[] | undefined> {
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

      const result = await this.convert(
        html,
        { imageDestination: settings.imageDestination, canSaveImages },
        token,
      );
      if (!result) return undefined; // cancelled: nothing is inserted and nothing is said

      const warnings: string[] = [];
      if (settings.rejected) {
        warnings.push(
          `Paste as Markdown: cannot use "${settings.rejected.configured}" as the image destination (${REJECTION_TEXT[settings.rejected.reason]}), so images go to "${DEFAULT_IMAGE_DESTINATION}" instead.`,
        );
      }
      const dropped = summarizeDropped(result.dropped);
      if (dropped) warnings.push(dropped);

      const edit = this.edit(result.markdown);
      const targets: vscode.Uri[] = [];
      if (result.images.length > 0) {
        const files = new vscode.WorkspaceEdit();
        for (const image of result.images) {
          const target = vscode.Uri.joinPath(
            document.uri,
            '..',
            ...imageTargetSegments(settings.imageDestination, image.fileName),
          );
          files.createFile(target, { ignoreIfExists: true, contents: image.bytes });
          targets.push(target);
        }
        edit.additionalEdit = files;
      }

      if (warnings.length > 0 || targets.length > 0) {
        if (result.markdown === '') {
          // an empty insert makes no text change, so its landing cannot be watched for;
          // only the explicit command is sure enough that the paste happened to speak up
          if (isRequested(context)) {
            for (const warning of warnings) void vscode.window.showWarningMessage(warning);
          }
        } else {
          this.watcher.expect(document, result.markdown, { warnings, targets });
        }
      }
      return [edit];
    } catch (error) {
      // an option the picker only lists is simply not offered; the user asked for nothing
      if (!isRequested(context)) return undefined;
      const reason = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Paste as Markdown failed: ${reason}`);
      return undefined;
    }
  }

  private edit(text: string): vscode.DocumentPasteEdit {
    const edit = new vscode.DocumentPasteEdit(text, TITLE, PASTE_KIND);
    edit.yieldTo = [vscode.DocumentDropOrPasteEditKind.Text];
    return edit;
  }
}
