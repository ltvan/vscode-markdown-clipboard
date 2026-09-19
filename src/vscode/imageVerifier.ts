import * as vscode from 'vscode';

export interface ImageVerifierOptions {
  intervalMs?: number;
  attempts?: number;
  armedMs?: number;
}

/**
 * VS Code creates the image files itself, after the provider has returned, and
 * inserts the text even when a file cannot be created. The text change fires
 * before the files exist, so wait for it and then poll.
 */
export class ImageVerifier {
  private readonly intervalMs: number;
  private readonly attempts: number;
  private readonly armedMs: number;

  constructor(options: ImageVerifierOptions = {}) {
    this.intervalMs = options.intervalMs ?? 150;
    this.attempts = options.attempts ?? 20;
    this.armedMs = options.armedMs ?? 60_000;
  }

  expect(document: vscode.TextDocument, insertedText: string, targets: vscode.Uri[]): void {
    const subscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document !== document) return;
      if (
        !event.contentChanges.some((change) => change.text.replace(/\r\n/g, '\n') === insertedText)
      ) {
        return;
      }
      disarm();
      void this.report(targets);
    });
    // the user may pick another paste option, so the edit is never applied
    const timer = setTimeout(() => subscription.dispose(), this.armedMs);
    const disarm = (): void => {
      clearTimeout(timer);
      subscription.dispose();
    };
  }

  private async report(targets: vscode.Uri[]): Promise<void> {
    let missing = targets;
    for (let attempt = 0; attempt < this.attempts && missing.length > 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, this.intervalMs));
      missing = await this.missingOf(missing);
    }
    if (missing.length === 0) return;
    const names = missing.map((uri) => uri.path.slice(uri.path.lastIndexOf('/') + 1)).join(', ');
    void vscode.window.showErrorMessage(
      `Paste as Markdown: could not save ${names}. The text was pasted; undo to revert it.`,
    );
  }

  private async missingOf(targets: vscode.Uri[]): Promise<vscode.Uri[]> {
    const exists = await Promise.all(
      targets.map((uri) =>
        Promise.resolve(vscode.workspace.fs.stat(uri)).then(
          () => true,
          () => false,
        ),
      ),
    );
    return targets.filter((_, index) => !exists[index]);
  }
}
