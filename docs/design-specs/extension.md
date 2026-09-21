# Extension design

Last updated: 2026-09-20

How the extension is currently built. Decisions and their history live in `docs/specs/`.

## Layers

```
src/extension.ts   composition root: registers the provider and the command
src/vscode/        adapter — the only code that imports 'vscode'
src/core/          pure TypeScript: no 'vscode', no file system, no network
```

- ESLint enforces the core's purity (`eslint.config.mjs`): it may not import `vscode`, `fs`, `http`, `https`, `net`, `http2`, `tls`, `dgram`, `dns`, `child_process`, `worker_threads` or `cluster`, nor use the `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` or `navigator` globals. ESLint blocks the usual routes to I/O from `src/core/`; it is a tripwire against accidental I/O, not a sandbox.
- The seam is `convert(html, options) → { markdown, images[], dropped[] }` in `src/core/convert.ts`. The core returns image bytes and names; the adapter decides where files go.
- The conversion engine (unified: rehype-parse → rehype-remark → remark-gfm → remark-stringify) is an implementation detail of `convert()`.
- A fix belongs on the tree where its cause and its evidence both live:
  - **HTML-tree cleanups**, under `src/core/html/`, run before `rehype-remark` converts the tree: `wordLists.ts` and `clean.ts` undo what a source application (Word, Google Docs) put in its exported markup, and `images.ts` (`rewriteImages`) rewrites `<img>` while it is still an element with a `src` attribute.
  - **Markdown-tree fixes** run afterward, on the `mdast` produced by `rehype-remark`: `tightLists.ts` corrects looseness because `rehype-remark`'s own rule (any nested list of two or more items makes the parent item loose) does not match the shape this extension wants; `safeLinks.ts` removes unsafe link targets there, not on the HTML tree, because `<iframe>`, `<video>` and `<audio>` — not just `<a>` — only become Markdown links or images once `rehype-remark` has run, so no single HTML-tree check could catch them all.
  - A new bug fix goes on whichever tree first has the shape the fix needs to see. Don't move a fix to "simplify" it onto the other tree; that reintroduces bugs this split already closed.

## Cross-cutting rules

- **A normal paste is never altered.** The paste provider returns nothing unless `context.triggerKind` is `PasteAs`. Every new paste feature keeps this guard.
- **One atomic edit.** Text and created files travel in one `DocumentPasteEdit`, so one undo reverts both. VS Code applies the text even when a file cannot be created, so the paste-landing watcher checks the files after the paste lands and reports the missing ones.
- **Failures are never silent.** Dropped images produce one warning; conversion and file failures produce an error.
- **Paths.** `resolveDestination()` in `src/core/paths.ts` expands `${workspaceFolder}`, `${documentDirName}` (start only) and `${documentBaseName}` (anywhere, but it names only a path segment — it cannot inject `/` or `..`) into a path relative to the document's folder; `src/vscode/settings.ts` only supplies the document's location. Links are therefore always document-relative, use `/` and are percent-encoded. Absolute paths, unknown or misplaced variables, a control character, and `${workspaceFolder}` outside a workspace folder are rejected host-independently; the default is used and the provider warns.

### Clipboard HTML is untrusted input

The HTML on the clipboard comes from whatever the user copied — a web page, a document, anything — and is treated accordingly:

- **No path is ever derived from the HTML.** An embedded image's file name is `image-<16 hex digits of a content hash>.<ext>`, where the hex digits come from hashing the decoded bytes and the extension comes from an allow-listed MIME type (`src/core/images.ts`). The HTML itself — its `src`, any attribute, anything — never contributes a character to a path.
- **SVG is saved only when `isCleanSvg()` (`src/core/svg.ts`) accepts it, and it is an allow-list on purpose.** It recognizes a fixed set of drawing elements and rejects everything else: no `<!` of any kind (comment, doctype, CDATA), no event handler, no reference except a same-document `#…` fragment. A block-list cannot fail safe; the reasoning is in the spec's owner decisions. Do not loosen this list to admit a rejected SVG — a hand-rolled regex-based scanner is not equipped to reason about markup it wasn't written to expect. If broader SVG support is ever wanted, the only sound way to get it is to parse the SVG with a real XML parser and inspect the resulting tree, not to extend the pattern matching in `svg.ts`.
- **Unsafe link schemes are removed on the Markdown tree**, by `src/core/safeLinks.ts`: a `javascript:`, `vbscript:` or `data:` link target keeps its text and loses the link. The same target on an image removes the image and reports it as a dropped image (`unsupported-source`), and a link left empty by that removal is removed too. This runs after `rehype-remark`, because several HTML elements become links or images by then, not only `<a>`.
- **`<base>` is dropped** (`src/core/html/clean.ts`), because `hast-util-to-mdast` resolves every `href` and `src` against a `<base>` if one is present, and a clipboard fragment must not be allowed to rebase links this way.
- **VS Code's own Markdown preview is a supported copy source, and its links are handled with the same suspicion.** The preview rewrites every link's `href` to a webview resource URL and keeps the real target in `data-href`. `clean()` (`src/core/html/clean.ts`) substitutes `data-href` for `href` only when the existing `href` is already one of those webview URLs (`vscode-webview:`, `vscode-resource:`, or `https://file+....vscode-resource.vscode-cdn.net/`) and the trimmed `data-href` is non-empty — never on an arbitrary `href`, because on any other page `data-href` is just another attacker-controlled attribute that could show one target while linking to another. The unsafe-scheme guard below still runs afterwards on whichever value ends up as `href`. Test pointers: `test/core/convert.test.ts` ("convert: links copied from the VS Code Markdown preview"), `test/core/fixtures/real-markdown-preview/`.
- **No accidental network or file-system access from the core** — ESLint blocks the usual routes to I/O from `src/core/` (see Layers above); it is a tripwire against accidental I/O, not a sandbox.

### Whitespace and emptiness cleanup

- **A non-breaking space in text becomes a regular space.** `normalizeNbsp()` (`src/core/html/whitespace.ts`) replaces every U+00A0 in a text node with an ordinary space, except inside `<pre>` and `<code>`, whose content stays verbatim; this only ever touches text nodes, so an attribute value such as `alt` is left as it is. Test pointers: `test/core/convert.test.ts` ("convert: non-breaking spaces").
- **Stray filler is dropped; real content never is.** `removeStrayEmptiness()` (`src/core/html/whitespace.ts`) removes a `<p>` only when it has no text _and_ holds no embedded element (`img`, `iframe`, `video`, `audio`, `embed`, `object`, `picture`, `svg` — such an element can have real content with no text of its own). It removes a `<br>` only when both neighbouring siblings are block-level or absent, judged by the `<br>`'s own siblings and never by its parent tag, so a soft line break inside a `<div>` or at the root still survives. Nothing inside a `<pre>` is touched by either rule. Test pointers: `test/core/convert.test.ts` ("convert: stray content between blocks"), the `real-word` and `real-google-docs` fixtures.

### Side effects happen when the edit lands

`provideDocumentPasteEdits` itself has no UI side effects: it returns an edit and nothing else. This matters because VS Code calls the provider whenever the user merely opens **Paste As…**, before any option is chosen — showing a warning there would talk about an edit the user might not pick. It also matters because VS Code never calls `resolveDocumentPasteEdit` on the `editor.action.pasteAs` path this extension uses, so that hook cannot be where side effects live either.

Instead, `PasteLandingWatcher` (`src/vscode/pasteLanding.ts`) watches the target document for the edit's exact inserted text to actually appear, and only then shows the warnings and polls for the created image files (VS Code applies the text before the files necessarily exist). One exception: when the converted Markdown is the empty string, there is no text change to watch for, so an empty insert cannot be confirmed this way — in that one case, warnings are shown immediately, and only for the explicit command (never for a picker-filling call), since only the explicit command is sure enough that the paste actually happened. Two in-flight pastes of identical text into the same document share one pending report, by design: the watcher cannot otherwise tell which of the two later text changes is which.

### Conversion runs in a worker thread

`convertInBackground()` (`src/vscode/backgroundConvert.ts`) runs `convert()` in a Node worker thread, built as a second esbuild bundle (`dist/convertWorker.js`, from `src/vscode/convertWorker.ts`) next to `dist/extension.js`. This keeps the extension host responsive on a large clipboard, lets cancelling the paste terminate the worker outright, and gives the worker a 512 MB memory ceiling (`resourceLimits.maxOldGenerationSizeMb`) so a pathological clipboard fails with an error instead of exhausting the host. Where worker threads don't exist (a host without `node:worker_threads`, such as the web), conversion falls back to running in-process (no web bundle is shipped today; the fallback only keeps the core web-compatible).

`PasteAsMarkdownProvider` takes its converter as a constructor parameter (the `Converter` type in `src/vscode/pasteProvider.ts`) rather than importing `convertInBackground` directly, so unit tests can construct the provider with an in-process converter and never touch worker threads.

### Untrusted workspaces

The manifest declares `capabilities.untrustedWorkspaces` with `restrictedConfigurations: ["markdownClipboard.imageDestination"]`. In a workspace VS Code has not marked trusted, the workspace's value is ignored; the user-level value, or the default `assets`, applies instead.

## Tests

- `test/core/` — unit tests and golden fixtures (`input.html` / `expected.md`). Every conversion bug becomes a new fixture. Fixtures are byte-exact: excluded from Prettier, EditorConfig and Git line-ending conversion.
- `test/adapter/` — the adapter against a stubbed `vscode` module (`test/adapter/vscodeStub.ts`).
- The security rules above are covered by `test/core/svg.test.ts`, the `test/core/fixtures/unsafe-links/` fixture, `test/core/convert.test.ts`, `test/adapter/pasteLanding.test.ts` and `test/adapter/backgroundConvert.test.ts`.
- `test/e2e/` — inside VS Code, asserting user-observable behavior only. They seed the real system clipboard (`test/e2e/clipboard.ts`: `osascript` on macOS, PowerShell on Windows, CopyQ on Linux — not `xclip`, which can offer only one clipboard format at a time, where these tests need several) and wait by polling, because `editor.action.pasteAs` resolves before the edit is applied. The VS Code test window must have keyboard focus for these tests to mean anything: `editor.action.pasteAs` is inert without it. Run them on an otherwise-idle machine, or under a virtual display, not in the background while using the machine for something else. Because focus can be lost for a moment on shared CI runners, the e2e suite allows one retry per test (`.vscode-test.mjs`); if the same test keeps needing it, remove the retry and find the cause.

## Known behavior

- The SVG cleanliness check is strict by design (see above) and rejects many ordinary, legitimately-exported SVGs: one with a `<style>` element, a doctype, a comment, an editor's own metadata elements, a backslash anywhere in the markup, or an `&` character inside a tag will all fail the check. Such an SVG is dropped and the paste warns about it, the same as any other unsupported image.
