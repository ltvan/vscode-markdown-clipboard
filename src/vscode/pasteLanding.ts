import * as vscode from 'vscode';

export interface PasteLandingOptions {
  intervalMs?: number;
  attempts?: number;
  armedMs?: number;
}

/** What a paste owes the user once, and only once, its edit is really applied. */
export interface PasteEffects {
  /** Shown as the edit lands, in order. */
  warnings: string[];
  /** Image files VS Code creates with the edit; the missing ones are reported. */
  targets: vscode.Uri[];
}

/**
 * VS Code applies the chosen paste edit itself and tells the provider nothing about it:
 * `resolveDocumentPasteEdit` is not called on the `editor.action.pasteAs` path, and the
 * provider is also asked for edits that merely fill the "Paste As…" picker and are never
 * applied. So the text change is the only honest signal that the paste happened, and
 * everything the user should see hangs off it. Nothing lands within `armedMs` when the
 * option was never chosen, and then nothing is said.
 *
 * VS Code also inserts the text even when a file in the same edit cannot be created, and
 * the change fires before the files exist, so the files are polled for afterwards.
 */
export class PasteLandingWatcher implements vscode.Disposable {
  private readonly intervalMs: number;
  private readonly attempts: number;
  private readonly armedMs: number;
  /** One pending watch per document and inserted text, so listeners cannot stack up. */
  private readonly pending = new Map<vscode.TextDocument, Map<string, () => void>>();

  constructor(options: PasteLandingOptions = {}) {
    this.intervalMs = options.intervalMs ?? 150;
    this.attempts = options.attempts ?? 20;
    this.armedMs = options.armedMs ?? 60_000;
  }

  expect(document: vscode.TextDocument, insertedText: string, effects: PasteEffects): void {
    const byText = this.pending.get(document) ?? new Map<string, () => void>();
    this.pending.set(document, byText);
    byText.get(insertedText)?.();

    const subscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document !== document) return;
      if (
        !event.contentChanges.some((change) => change.text.replace(/\r\n/g, '\n') === insertedText)
      ) {
        return;
      }
      disarm();
      for (const warning of effects.warnings) void vscode.window.showWarningMessage(warning);
      if (effects.targets.length > 0) void this.report(effects.targets);
    });
    // the user may pick another paste option, so the edit is never applied
    const timer = setTimeout(() => disarm(), this.armedMs);
    const disarm = (): void => {
      clearTimeout(timer);
      subscription.dispose();
      byText.delete(insertedText);
      if (byText.size === 0) this.pending.delete(document);
    };
    byText.set(insertedText, disarm);
  }

  dispose(): void {
    for (const byText of [...this.pending.values()]) {
      for (const disarm of [...byText.values()]) disarm();
    }
    this.pending.clear();
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
