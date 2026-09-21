# Markdown Clipboard

Paste rich clipboard content as Markdown — only when you ask for it.

Copy from a web page, Word, Google Docs, Notion or VS Code's own Markdown preview, then run **Markdown Clipboard: Paste as Markdown** from the Command Palette in a Markdown file. Headings, emphasis, links, lists, task lists, quotes, code, tables and images are converted. A normal paste (Ctrl/Cmd+V) is never changed. With no rich text on the clipboard, the command pastes the plain text unchanged.

Every conversion runs in the background, so VS Code stays responsive and the paste can be cancelled like any other.

## Images

- Images with a web address stay links: `![alt](https://…)`. Nothing is downloaded.
- Images embedded in the clipboard are saved next to your document, in `assets/` by default, as `image-<16 hex digits>.<ext>` — the name comes from the image's own content, so pasting the same image again reuses the same file.
- Some embedded images are left out; a warning tells you how many and why:
  - an unsupported type (only PNG, JPEG, GIF, WebP and SVG are saved);
  - image data that could not be decoded;
  - a source that cannot be linked, such as a sender's own temporary file path;
  - an untitled document, which has no folder to save into;
  - an SVG that did not pass the safety check.

  An SVG is accepted only if it contains nothing but plain drawing markup — shapes, paths, gradients and the like — with no script, no embedded style sheet, no comment or document type declaration, and no reference to anything outside the file itself. The check is strict on purpose: a saved SVG lives in your project and could later be served from it, where a script inside it would run, so many SVGs exported by design tools (which often add comments, editor metadata or a style sheet) are rejected.

## Links

A link whose target uses the `javascript:`, `vbscript:` or `data:` scheme keeps its text and loses the link. An image with such a target is left out.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `markdownClipboard.imageDestination` | `assets` | Folder for images embedded in pasted content. A plain path is relative to the document's folder (`..` is allowed; empty means the document's own folder). It may start with `${workspaceFolder}` (the workspace folder containing the document) or `${documentDirName}` (the document's folder), and may contain `${documentBaseName}` (the document's file name without extension) anywhere. Links are always written relative to the document. An absolute path, an unknown variable, a start-only variable used elsewhere, a control character, or `${workspaceFolder}` for a file outside the workspace is rejected: images go to `assets` and a warning says why. |

In an untrusted workspace, the workspace's own value for this setting is ignored; your user-level value, or the default `assets`, is used.

## Keybinding

None by default. To add one, bind `markdownClipboard.pasteAsMarkdown` in Keyboard Shortcuts, for example to `Ctrl+Alt+V` with `when: editorLangId == markdown`.

The command also appears in VS Code's **Paste As…** list.

## Development

Needs Node 22.12 or newer; on Linux, the e2e suite needs CopyQ.

```bash
pnpm install
pnpm test:unit      # fast loop
pnpm format && pnpm lint && pnpm typecheck && pnpm test   # gates
pnpm package        # build a .vsix
```

To try the extension, open this folder in VS Code and press F5 (**Run Extension**): it builds the extension and opens a second VS Code window with it loaded. Open a Markdown file there, copy something from a web page, and run **Markdown Clipboard: Paste as Markdown**.

The gates command's `pnpm test` step includes the e2e suite, which opens a VS Code window: that window needs keyboard focus for the tests to do anything, and the suite overwrites your system clipboard.

Design: [docs/design-specs/extension.md](docs/design-specs/extension.md). Commit messages: [docs/git-convention.md](docs/git-convention.md).
