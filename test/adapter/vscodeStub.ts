import { posix } from 'node:path';
import { vi } from 'vitest';

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly path: string,
  ) {}
  static file(path: string): Uri {
    return new Uri('file', path);
  }
  static untitled(name: string): Uri {
    return new Uri('untitled', name);
  }
  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(base.scheme, posix.join(base.path, ...segments));
  }
  toString(): string {
    return `${this.scheme}:${this.path}`;
  }
}

export class DocumentDropOrPasteEditKind {
  static readonly Empty = new DocumentDropOrPasteEditKind('');
  static readonly Text = new DocumentDropOrPasteEditKind('text');
  constructor(readonly value: string) {}
  append(...parts: string[]): DocumentDropOrPasteEditKind {
    return new DocumentDropOrPasteEditKind([this.value, ...parts].filter(Boolean).join('.'));
  }
}

export enum DocumentPasteTriggerKind {
  Automatic = 0,
  PasteAs = 1,
}

export class DocumentPasteEdit {
  additionalEdit?: WorkspaceEdit;
  yieldTo?: DocumentDropOrPasteEditKind[];
  constructor(
    public insertText: string,
    public title: string,
    public kind: DocumentDropOrPasteEditKind,
  ) {}
}

export class WorkspaceEdit {
  readonly created: { uri: Uri; options: { ignoreIfExists?: boolean; contents?: Uint8Array } }[] =
    [];
  createFile(uri: Uri, options: { ignoreIfExists?: boolean; contents?: Uint8Array }): void {
    this.created.push({ uri, options });
  }
}

type ChangeListener = (event: { document: unknown; contentChanges: { text: string }[] }) => void;
const changeListeners = new Set<ChangeListener>();

export const testing = {
  configuration: new Map<string, unknown>(),
  workspaceFolder: undefined as Uri | undefined,
  existingFiles: new Set<string>(),
  fireDidChangeTextDocument(document: unknown, texts: string[]): void {
    for (const listener of [...changeListeners]) {
      listener({ document, contentChanges: texts.map((text) => ({ text })) });
    }
  },
  listenerCount: () => changeListeners.size,
  reset(): void {
    testing.configuration.clear();
    testing.workspaceFolder = Uri.file('/ws');
    testing.existingFiles.clear();
    changeListeners.clear();
    window.activeTextEditor = undefined;
    vi.clearAllMocks();
  },
};

export const window = {
  activeTextEditor: undefined as { document: { languageId: string } } | undefined,
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
};

export const commands = { executeCommand: vi.fn(async () => undefined) };

export const workspace = {
  getWorkspaceFolder(uri: Uri): { uri: Uri } | undefined {
    const folder = testing.workspaceFolder;
    return folder && uri.path.startsWith(`${folder.path}/`) ? { uri: folder } : undefined;
  },
  getConfiguration: (section: string) => ({
    get: <T>(key: string, fallback: T): T =>
      (testing.configuration.get(`${section}.${key}`) as T | undefined) ?? fallback,
  }),
  onDidChangeTextDocument(listener: ChangeListener): { dispose(): void } {
    changeListeners.add(listener);
    return { dispose: () => changeListeners.delete(listener) };
  },
  fs: {
    async stat(uri: Uri): Promise<unknown> {
      if (!testing.existingFiles.has(uri.toString())) throw new Error('FileNotFound');
      return {};
    },
  },
};
