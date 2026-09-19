# Paste as Markdown — design

Status: accepted (2026-09-20)

## Goal

A VS Code extension (TypeScript, pnpm) with one command, **Paste as Markdown**, that converts rich clipboard content (HTML) to Markdown and inserts it into the active Markdown document. It is the first feature of the extension, so this spec also fixes the project architecture and tooling, chosen for long-term maintenance.

## Requirements

Stated by the project owner. Changing any of these requires asking the owner first.

- R1. A command **Paste as Markdown** exists. Conversion happens **only when the user explicitly runs it**; a normal paste is never altered.
- R2. The source is the clipboard's HTML flavor (content copied from web pages, Word, Google Docs, Notion and similar).
- R3. Images inside the HTML are handled:
  - an `<img>` with a remote (`http`/`https`) URL is kept as `![alt](url)`; nothing is downloaded;
  - an `<img>` with an embedded `data:` URI is saved to a file and linked by relative path.
- R4. A raw image on the clipboard (e.g. a screenshot) is out of scope; VS Code's built-in Markdown paste keeps handling it.
- R5. The command applies to Markdown documents only.
- R6. Tests cover the requirements. E2e tests assert user-observable behavior only.
- R7. The project works cross-platform (macOS, Linux, Windows). The formatting configuration (EditorConfig, Prettier, Git attributes) already exists in the repository and is outside this spec.

## Acceptance criteria

Each criterion is user-observable and maps to at least one test (see [Testing](#testing)).

- AC1. In a Markdown editor, with HTML on the clipboard, running `Markdown Clipboard: Paste as Markdown` (`markdownClipboard.pasteAsMarkdown`) inserts the converted Markdown at the cursor, replacing any selection. With multiple cursors it inserts at each.
- AC2. A normal paste (`editor.action.clipboardPasteAction`, Ctrl/Cmd+V) is never converted. For each of three clipboard shapes — HTML only, HTML + plain text, HTML + image — the document after a normal paste does not contain the converted form of the fixture's sentinel (the HTML carries `<b>SENTINEL</b>`; the document must not contain `**SENTINEL**`) — for HTML only and HTML + image that is the entire assertion, since the built-in paste may legitimately act there; for HTML + plain text the document additionally contains exactly the seeded plain-text flavor (fixtures are chosen so the built-in Markdown paste does not transform them). The extension ships no default keybinding.
- AC3. Conversion covers: headings, paragraphs, bold, italic, strikethrough, links, ordered / unordered / nested lists, task lists, blockquotes, inline code, fenced code blocks, GFM tables, horizontal rules and line breaks. Hard line breaks are written as a trailing backslash. `<script>`, `<style>` and comments produce no output. Raw HTML is never passed through: an element with no Markdown equivalent (`<u>`, `<sub>`, `<details>`, merged-cell or nested tables) is reduced to its text content.
- AC4. `<img src="https://…" alt="x">` becomes `![x](https://…)`; a missing `alt` gives `![](…)`. No network request is made.
- AC5. `<img src="data:image/png;base64,…">` creates a file under the image destination and inserts `![alt](<relative path>)`. Supported types: PNG, JPEG, GIF, WebP, SVG. The file name is `image-<first 8 hex of SHA-256 of the bytes>.<ext>`, so pasting the same image twice reuses one file. Both base64 and percent-encoded `data:` URIs are decoded; an undecodable one is dropped as in AC7.
- AC6. The image destination is the resource-scoped setting `markdownClipboard.imageDestination`, a path relative to the document's folder, default `assets`. `..` segments are allowed; an empty value means the document's own folder; an absolute path is rejected — the default is used and a warning says so.
- AC7. In an untitled document (no folder), embedded images are dropped and a warning says so; the rest of the content is pasted. The same applies — image dropped, one warning summarizing what was dropped, rest pasted — to an embedded image of an unsupported type and to an `<img>` whose `src` is neither `http(s)` nor `data:` (Word's `file:///` temp paths, `blob:`, `cid:`, relative URLs).
- AC8. With no HTML on the clipboard, the command falls back to a plain paste: it inserts the clipboard's plain-text flavor unchanged, in full at each cursor (unlike the built-in paste, it does not spread lines across multiple cursors). With neither HTML nor plain text it inserts nothing; VS Code's own "no paste edits" hint may appear and is accepted.
- AC9. If conversion throws, or an image file cannot be created, an error message is shown and nothing is inserted — never partial output.
- AC10. "Markdown document" means language id `markdown` (notebook Markdown cells and MDX are excluded).
  - (a) The command's palette entry carries `when: editorLangId == markdown`.
  - (b) Invoking the command in any other editor leaves the document unchanged and creates no file. The command itself returns early when the active document's language id is not `markdown`, so this does not depend on VS Code's handling of an unmatched paste kind.
- AC11. With only a raw image on the clipboard, a normal paste into a saved Markdown document still gets the built-in image paste (the document then contains an image link and the image file exists on disk), and Paste as Markdown inserts nothing and creates no file; VS Code's own "no paste edits" hint may appear and is accepted (R4).
- AC12. The inserted image link always uses `/` separators, on Windows too, and is percent-encoded where Markdown requires it (e.g. spaces in the destination).
- AC13. Content copied from Word, Google Docs and Notion yields the AC3 constructs without source artifacts: Google Docs' wrapper `<b style="font-weight:normal">` does not make the text bold; Word's `mso-*` styles, conditional comments and `<o:p>` produce no output (R2).
- AC14. On a clean checkout on macOS, Linux and Windows, `pnpm lint` (including `prettier --check`) passes with no line-ending diffs, and `pnpm typecheck` and `pnpm test` (core, adapter, e2e) pass. A GitHub Actions matrix over the three OSes (Linux under xvfb) verifies this on every push (R7).

## Owner decisions (2026-09-20)

The acceptance criteria elaborate the requirements in places. These elaborations were put to the owner, who chose them or raised no objection; final confirmation is the owner's review of this spec:

- Replace the selection, insert at every cursor, no default keybinding (AC1, AC2).
- Setting `markdownClipboard.imageDestination`, default `assets`; `image-<hash8>` naming (AC5, AC6).
- Embedded-image allow-list PNG, JPEG, GIF, WebP, SVG. SVG is saved verbatim: Markdown preview does not execute scripts in images (AC5).
- Untitled documents, unsupported types and non-`http(s)`/`data:` sources drop the image with a warning (AC7).
- No HTML on the clipboard falls back to a plain paste (AC8).
- Cross-platform is verified by a 3-OS CI matrix in this slice (AC14).
- If clipboard seeding for e2e proves infeasible on an OS, the owner is asked before any case becomes by-hand.
- AC9's file-creation half stays as written for now. VS Code, not the extension, creates the files when it applies the edit, so the extension may be unable to catch that failure. The plan's spike records what VS Code actually does on a failed file creation (read-only destination); the owner then chooses between keeping one atomic edit with AC9 narrowed to conversion failures, or having the extension write files itself (error guaranteed, but undo no longer removes files). The plan is not finalized before that choice.

## Decisions

### D1. Clipboard access: `DocumentPasteEditProvider` + `editor.action.pasteAs`

`vscode.env.clipboard` reads plain text only. The paste-edit-provider API is the only official way to see `text/html`.

- The provider registers for `markdown` with `pasteMimeTypes: ['text/html', 'text/plain']` (plain text only for the AC8 fallback) and its own kind, `markdown.fromHtml` (a `DocumentDropOrPasteEditKind`).
- The command runs `editor.action.pasteAs` with `{ kind }`.
- Primary guard for R1: the provider returns no edit unless `context.triggerKind` is `PasteAs`. An automatic (normal) paste therefore never sees our edit, even when the clipboard has HTML and no plain text, and regardless of the user's `editor.pasteAs.preferences`.
- Secondary guard: the edit sets `yieldTo: [DocumentDropOrPasteEditKind.Text]`.
- Known and accepted: the option also appears in VS Code's "Paste As…" picker and paste widget. It cannot be hidden and is never applied unless chosen.
- Embedded images are written through the edit's `additionalEdit` (`WorkspaceEdit.createFile` with contents), so text and files land as one edit.
- Works on desktop and Remote/WSL; no process spawning. Web-compatible by design (no Node-only API in `src/`), but a web bundle is not packaged or verified in this slice.

Rejected:

- **Native clipboard helpers** (`osascript` / PowerShell / `xclip`) behind a plain command — three OS code paths, broken in Remote and web, spawns processes.
- **Hidden webview capturing a paste event** — focus hacks, poor UX.

### D2. Pure core, thin VS Code shell

The VS Code API is the volatile, hard-to-test part; conversion is the part that accumulates bug fixes. They are separated by one seam.

```
src/
  extension.ts            composition root: registers provider + command, nothing else
  vscode/                 adapter layer — the only code that imports 'vscode'
    pasteProvider.ts      DataTransfer → core → DocumentPasteEdit (+ createFile edits)
    pasteCommand.ts       runs editor.action.pasteAs { kind }
    settings.ts           typed configuration reader
  core/                   pure TypeScript, no 'vscode' import
    convert.ts            convert(html, options) → { markdown, images[], dropped[] }   ← the seam
    html/                 cleanup of Word / Google Docs / Notion markup
    images.ts             data: URI decoding, MIME → extension, file naming
    paths.ts              (document path, destination, file name) → target path + relative link
test/
  core/                   unit tests + golden fixtures
  adapter/                provider tests with a faked DataTransfer
  e2e/                    tests run inside VS Code
```

- ESLint forbids, under `src/core/`, importing `vscode`, `fs`, `http`, `https`, `net` and using the `fetch` global. This rule is what guarantees "no network, no file system" in the core (AC4).
- `convert()` returns a `Promise` (hashing is async in a web host) and is side-effect free: it returns image bytes and file names. Path and link computation is also pure and lives in `core/paths.ts`, including Windows separators (AC12). The adapter only wires: read `DataTransfer`, call the core, build the `WorkspaceEdit`, show messages.
- The seam: `options = { imageDestination, canSaveImages }`; the result is `{ markdown, images[], dropped[] }`, where `images[]` holds bytes and file names and `dropped[]` holds one entry per omitted image with its reason (unsupported type, undecodable, unsupported source, cannot save) — the adapter turns `dropped[]` into the single AC7 warning. `canSaveImages` is false for an untitled document. The link written into the Markdown is computed by `core/paths.ts` from `imageDestination` and the file name alone (empty destination → bare file name; separators normalized and encoded per AC12); no document path is needed. Only the target URI needs it, and the adapter derives that via `core/paths.ts` too.
- A pure predicate in `core/paths.ts` decides whether `imageDestination` is absolute, host-independently (`/x`, `C:\x` and `\\server\x` are rejected on every OS). `settings.ts` only calls it and emits the AC6 warning, before the core is called.
- Files are created with `ignoreIfExists` and never overwritten; the content-hash name makes an existing file with the same name the same image.

Data flow: command (language check) → `pasteAs(kind)` → provider checks the trigger kind → reads `text/html` (none → an edit inserting `text/plain` unchanged; neither → no edit) → reads settings and whether the document has a folder → `convert()` → one `DocumentPasteEdit` (insert text + create files) and at most one dropped-image warning (AC7), plus the AC6 setting warning when it applies.

### D3. Conversion engine: `unified`

`rehype-parse` → `rehype-remark` → `remark-gfm` → `remark-stringify`. AST-based, typed handlers, no DOM shim, actively maintained, runs in Node and web. It sits behind `convert()` and can be replaced without touching `src/vscode/`.

Rejected: **turndown** — string/DOM-rule based, needs a DOM implementation in Node, slower maintenance.

### D4. Tooling

- pnpm; esbuild bundles to a single `dist/extension.js`; packaging uses `vsce package --no-dependencies` (required with pnpm, safe because everything is bundled).
- `tsconfig.json` sets `strict: true` (which includes `strictNullChecks`) plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch` and `exactOptionalPropertyTypes`. Most of this extension's failure modes are "the value is not there" — no HTML flavor on the clipboard, no active editor, an untitled document with no folder, a missing `alt` — and these flags make the compiler force each of those branches to be handled. They are enabled from the first commit because turning them on later is a large migration.
- `tsc --noEmit` (strict) for type checking; ESLint (typescript-eslint) for linting; Prettier for formatting.
- TypeScript formatting (`.prettierrc.json`): `singleQuote: true`, `printWidth: 100`, `semi: true`, `trailingComma: "all"`, `arrowParens: "always"`. The last three are Prettier's defaults, written out so the style does not shift if a future Prettier major changes a default. Semicolons are kept: they avoid the ASI hazards on lines starting with `(`, `[` or a template literal, and match VS Code's own code and samples. Single quotes are the prevailing TypeScript convention; width 100 because `vscode.*` calls wrap awkwardly at 80. `eslint-config-prettier` turns off ESLint rules that overlap with Prettier.
- `engines.vscode` is the first release where the document-paste API is stable (believed 1.97; confirmed when the plan is written).
- Quality gates, recorded in `CLAUDE.md`: `pnpm lint && pnpm typecheck && pnpm test` (`pnpm lint` includes `prettier --check`).

## Testing

Test-first throughout. Three layers:

**Core unit tests (vitest)** — `convert()` and `images.ts`. Golden fixtures are the long-term asset: each case is an `input.html` / `expected.md` pair (Chrome, Word, Google Docs, Notion captures plus hand-written minimal cases per AC3 construct). Every future bug report becomes a new pair. Covers AC3, AC4 (output and "no network" by construction — the core has no I/O), AC5 (decoding, naming, supported types), the absolute-path, `..` and empty-value cases of AC6, and the unsupported-type, undecodable and unsupported-source (`file:///`, `blob:`, `cid:`, relative) cases of AC7.

**Adapter tests (vitest, faked `DataTransfer` and a stubbed `vscode` module)** — the provider's branching: trigger-kind guard, no HTML → plain-text edit, neither flavor → no edit, untitled document, `convert()` throwing → error message and no edit, warnings chosen. Covers the failure half of AC9, which no clipboard content can trigger because HTML parsing is error-tolerant. A manifest test asserts AC10(a) against `package.json`.

**E2e tests (`@vscode/test-cli`, run inside VS Code)** — assert user-observable behavior only: document text, files on disk, shown messages, and the effect of invoking commands. They do not inspect provider objects, internal calls or the core's return values. VS Code has no API to read notifications, so a spy on `vscode.window.showWarningMessage` / `showErrorMessage` is the accepted stand-in for "a message is shown". The real system clipboard is seeded by a test-only per-OS helper (`osascript` / `xclip` / PowerShell), since VS Code has no API to write HTML to the clipboard; the helper lives under `test/` and is never shipped. Clipboard tests run serially and overwrite the developer's clipboard.

| Criterion | Core | Adapter | E2e |
| --- | --- | --- | --- |
| AC1 insert at cursor(s) / selection | | | ✓ |
| AC2 normal paste never converted (3 clipboard shapes) | | ✓ | ✓ |
| AC3 conversion constructs | ✓ | | |
| AC4 remote image kept, no download | ✓ + lint rule | | ✓ |
| AC5 embedded image saved + linked, deduplicated | ✓ | | ✓ |
| AC6 destination setting | ✓ | ✓ | ✓ |
| AC7 untitled doc / unsupported type / unsupported source | ✓ | ✓ | ✓ |
| AC8 no HTML → plain paste | | ✓ | ✓ |
| AC9 failure → error, nothing inserted | | ✓ (conversion throws) | file-creation half: decided after the spike |
| AC10 Markdown documents only | | ✓ (manifest) | ✓ |
| AC11 raw image clipboard untouched | | | ✓ |
| AC12 link separators and encoding | ✓ | | |
| AC13 Word / Google Docs / Notion artifacts | ✓ | | |
| AC14 formatting + suite green on 3 OSes | | | CI matrix |

The first task of the plan is a spike that proves clipboard seeding (HTML, HTML + plain, HTML + image, image only) on each OS and settles the "To verify" facts below, including the outcome of a failed file creation (AC9). If seeding proves infeasible anywhere, the owner is asked before any e2e case is downgraded to a by-hand case.

## To verify while planning

These are implementation facts, not requirements. If any turns out false in a way that touches a requirement or acceptance criterion, the owner is asked before anything changes.

- The exact VS Code version where `DocumentPasteEditProvider` became stable.
- `editor.action.pasteAs` accepts a `kind` argument that selects our provider without showing a picker.
- Whether one undo also removes files created through `additionalEdit`.
- `editor.action.pasteAs` with a `kind` that yields no edit does not fall through to the default paste (AC8, AC11).
- `context.triggerKind` distinguishes `PasteAs` from `Automatic` as D1 assumes.
- Whether a failed `additionalEdit` file creation also cancels the text insert (AC9).

## Documentation produced by the plan

- `docs/design-specs/extension.md` — the enduring architecture, from D2.
- The `Quality gates:` line in `CLAUDE.md`.

## Out of scope

Raw image paste (R4), downloading remote images, non-Markdown documents, default keybindings, copy-as-HTML or any other clipboard direction, a packaged web bundle, publishing/release automation.
