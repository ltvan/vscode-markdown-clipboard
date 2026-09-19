# Paste as Markdown — implementation plan

Status: draft (2026-09-20)

**Goal:** Ship a VS Code extension with one explicit command, Paste as Markdown, that converts clipboard HTML (including embedded images) to Markdown in Markdown documents.

**Architecture:** A pure TypeScript core (`src/core/`, no `vscode`, no I/O) converts HTML to Markdown and returns image bytes and dropped-image reasons. A thin adapter (`src/vscode/`) wires the core to a `DocumentPasteEditProvider` that only acts on an explicit Paste As, builds one atomic edit (text + file creations), and verifies the files after the paste lands.

**Tech stack:** TypeScript 6.0 (typescript-eslint does not yet support 7.x), pnpm, esbuild, unified (rehype-parse, rehype-remark, remark-gfm, remark-stringify), vitest, `@vscode/test-cli` + mocha, ESLint + Prettier, GitHub Actions.

**Spec:** [docs/specs/260920-paste-as-markdown-design.md](../specs/260920-paste-as-markdown-design.md). Read it first; AC numbers below refer to it.

## Global constraints

- `engines.vscode` is `^1.97.0`.
- Command id `markdownClipboard.pasteAsMarkdown`, title `Paste as Markdown`, category `Markdown Clipboard`. Setting `markdownClipboard.imageDestination`, resource-scoped, default `assets`. Paste kind `markdown.fromHtml`.
- No default keybinding.
- Only files under `src/vscode/` and `src/extension.ts` import `vscode`. `src/core/` imports no `vscode`, `fs`, `http`, `https`, `net` and does not use `fetch`.
- `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `exactOptionalPropertyTypes`. If `exactOptionalPropertyTypes` conflicts with third-party typings, drop only that flag and record why in the design spec.
- Test-first: every task writes the failing test before the code, and the e2e tests (Task 5) are written and seen failing before the adapter (Task 6) exists.
- E2e tests assert user-observable behavior only: document text, files on disk, shown messages (via a spy on `vscode.window.show*Message`), effect of commands. They wait for outcomes by polling, because `editor.action.pasteAs` resolves before the edit is applied.
- Quality gates before every commit: `pnpm format && pnpm lint && pnpm typecheck && pnpm test`. Until Task 5 creates the e2e project, `typecheck` and `test` cover only the unit-tested code; Task 5 widens both scripts. E2e tests open a VS Code window and overwrite the clipboard.
- Stage files by explicit path, never `git add -A`.
- Commit messages follow [docs/git-convention.md](../git-convention.md).
- Requirements and acceptance criteria are the owner's. If a task cannot meet one as written, stop and ask the owner; do not adjust the criterion.

## File map

| File | Responsibility |
| --- | --- |
| `pnpm-workspace.yaml` | Which dependencies may run install scripts (pnpm 11) |
| `package.json` | Manifest: command, palette `when`, setting, activation, scripts, dependencies |
| `tsconfig.json`, `test/e2e/tsconfig.json` | Type checking (no emit); e2e compilation to `out/e2e` |
| `esbuild.mjs` | Bundle `src/extension.ts` → `dist/extension.js` (CJS, `vscode` external) |
| `eslint.config.mjs`, `vitest.config.mts`, `.vscode-test.mjs` | Lint, unit-test and e2e runner configuration |
| `src/core/types.ts` | `ConvertOptions`, `ConvertResult`, `ConvertedImage`, `DroppedImage`, `DropReason` |
| `src/core/paths.ts` | Absolute-destination predicate, target segments, Markdown link |
| `src/core/images.ts` | `data:` URI decoding, MIME → extension, content-hash file name |
| `src/core/html/wordLists.ts` | Rebuild Word's list paragraphs (`mso-list`) into real `<ul>` / `<ol>` |
| `src/core/html/clean.ts` | Remove comments and namespaced (Word) elements, unwrap Google Docs wrapper, map styled spans |
| `src/core/html/images.ts` | Rewrite or drop `<img>` elements, collect images and dropped reasons |
| `src/core/convert.ts` | The seam: `convert(html, options)` |
| `src/core/tightLists.ts` | Markdown-tree fix: nested lists stay tight |
| `src/core/dropped.ts` | `summarizeDropped()` — the one AC7 warning text |
| `src/vscode/settings.ts` | Read and validate `imageDestination` |
| `src/vscode/pasteProvider.ts` | The paste edit provider |
| `src/vscode/imageVerifier.ts` | After the paste lands, report image files that do not exist (AC9(b)) |
| `src/vscode/pasteCommand.ts` | The command: language check, then `editor.action.pasteAs` |
| `src/extension.ts` | Composition root |
| `test/core/**` | Core unit tests and golden fixtures |
| `test/adapter/**` | Adapter tests against `test/adapter/vscodeStub.ts`; manifest test |
| `test/e2e/**` | E2e tests, clipboard seeding helper |
| `.github/workflows/ci.yml` | 3-OS matrix |
| `docs/design-specs/extension.md`, `README.md` | Enduring design; user documentation |

---

### Task 1: Project scaffold, quality gates, manifest

**Files:**

- Create: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` (generated), `tsconfig.json`, `esbuild.mjs`, `eslint.config.mjs`, `vitest.config.mts`, `.gitignore`, `.vscodeignore`, `src/extension.ts`, `test/adapter/manifest.test.ts`, `test/adapter/vscodeStub.ts`

**Interfaces:**

- Produces: scripts `build`, `typecheck`, `lint`, `format`, `test:unit`, `test`, `package` (`test:e2e` arrives in Task 5); the manifest values in Global constraints.

- [ ] **Step 1: Write `package.json` — without the `contributes` block for now**

Step 8 adds `contributes` after its test has been seen failing. Everything else below goes in now.

```json
{
  "name": "markdown-clipboard",
  "displayName": "Markdown Clipboard",
  "description": "Paste rich clipboard content as Markdown, only when you ask for it.",
  "version": "0.0.1",
  "publisher": "ltvan",
  "repository": { "type": "git", "url": "https://github.com/ltvan/vscode-markdown-clipboard.git" },
  "engines": { "vscode": "^1.97.0", "node": ">=22.12" },
  "categories": ["Other"],
  "main": "./dist/extension.js",
  "activationEvents": ["onLanguage:markdown"],
  "contributes": {
    "commands": [
      {
        "command": "markdownClipboard.pasteAsMarkdown",
        "title": "Paste as Markdown",
        "category": "Markdown Clipboard"
      }
    ],
    "menus": {
      "commandPalette": [
        { "command": "markdownClipboard.pasteAsMarkdown", "when": "editorLangId == markdown" }
      ]
    },
    "configuration": {
      "title": "Markdown Clipboard",
      "properties": {
        "markdownClipboard.imageDestination": {
          "type": "string",
          "default": "assets",
          "scope": "resource",
          "markdownDescription": "Folder for images embedded in pasted content, relative to the document's folder. `..` is allowed; an empty value means the document's own folder; an absolute path is rejected."
        }
      }
    }
  },
  "scripts": {
    "build": "node esbuild.mjs",
    "typecheck": "tsc --noEmit",
    "lint": "eslint . && prettier --check .",
    "format": "prettier --write .",
    "test:unit": "vitest run",
    "test": "pnpm test:unit",
    "package": "node esbuild.mjs --production && vsce package --no-dependencies --skip-license"
  }
}
```

`publisher` is the repository owner's GitHub name; the owner may change it before publishing. No `license` field is set — ask the owner before adding one; until then `--skip-license` keeps `vsce package` from prompting. Task 5 adds the `test:e2e` script and widens `typecheck` and `test`.

- [ ] **Step 2: Allow esbuild's install script, then install dependencies**

pnpm 11 no longer reads the `pnpm` field of `package.json` and fails the install when a dependency's build script has not been decided. `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  '@vscode/vsce-sign': false
  esbuild: true
```

```bash
pnpm add unified rehype-parse rehype-remark remark-gfm remark-stringify unist-util-visit
pnpm add -D typescript@~6.0 @types/node@^22 @types/vscode@~1.97.0 @types/hast @types/mdast @types/mocha \
  esbuild vitest eslint typescript-eslint eslint-config-prettier prettier \
  @vscode/test-cli @vscode/test-electron @vscode/vsce
```

`@types/vscode` is pinned to the `engines.vscode` floor so newer API cannot be used by accident.

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test/core", "test/adapter", "vitest.config.mts"]
}
```

`DOM` is in `lib` only for the `crypto`, `atob`, `TextEncoder` globals, which exist in both Node 22 and the web extension host.

- [ ] **Step 4: Write `esbuild.mjs`**

```js
import { build } from 'esbuild';

await build({
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  // the extension host of the engines.vscode floor (1.97) runs Node 20
  target: 'node20',
  external: ['vscode'],
  sourcemap: true,
  minify: process.argv.includes('--production'),
});
```

- [ ] **Step 5: Write `eslint.config.mjs`**

```js
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

const impure = ['vscode', 'fs', 'fs/promises', 'http', 'https', 'net'].flatMap((name) => [
  name,
  `node:${name}`,
]);

export default tseslint.config(
  { ignores: ['dist/', 'out/', '.vscode-test/', 'test/core/fixtures/'] },
  ...tseslint.configs.recommended,
  {
    // provider methods keep their full signature; unused parameters are prefixed with _
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: impure.map((name) => ({
            name,
            message: 'src/core must stay pure: no VS Code API, no I/O.',
          })),
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'src/core must never touch the network.' },
      ],
    },
  },
  prettier,
);
```

- [ ] **Step 6: Write `vitest.config.mts`**

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/core/**/*.test.ts', 'test/adapter/**/*.test.ts'] },
  resolve: {
    alias: { vscode: fileURLToPath(new URL('./test/adapter/vscodeStub.ts', import.meta.url)) },
  },
});
```

- [ ] **Step 7: Write `.gitignore`, `.vscodeignore` and a minimal `src/extension.ts`**

`.gitignore`:

```
node_modules/
dist/
out/
.vscode-test/
*.vsix
```

`.vscodeignore`:

```
**
!dist/extension.js
!package.json
!README.md
!LICENSE
```

`src/extension.ts` (Task 6 replaces the body):

```ts
import type * as vscode from 'vscode';

export function activate(_context: vscode.ExtensionContext): void {}
```

- [ ] **Step 8: The manifest test (AC10(a), no default keybinding), then the `contributes` block**

`test/adapter/manifest.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

describe('manifest', () => {
  it('offers the command in the palette only for Markdown editors', () => {
    expect(manifest.contributes.commands).toEqual([
      {
        command: 'markdownClipboard.pasteAsMarkdown',
        title: 'Paste as Markdown',
        category: 'Markdown Clipboard',
      },
    ]);
    expect(manifest.contributes.menus.commandPalette).toEqual([
      { command: 'markdownClipboard.pasteAsMarkdown', when: 'editorLangId == markdown' },
    ]);
  });

  it('ships no default keybinding', () => {
    expect(manifest.contributes.keybindings).toBeUndefined();
  });

  it('declares the image destination as a resource-scoped setting defaulting to assets', () => {
    const setting =
      manifest.contributes.configuration.properties['markdownClipboard.imageDestination'];
    expect(setting.default).toBe('assets');
    expect(setting.scope).toBe('resource');
  });

  it('requires the first VS Code release with the stable paste API', () => {
    expect(manifest.engines.vscode).toBe('^1.97.0');
  });
});
```

Write this test and Step 9's stub now, run `pnpm test:unit`, and see it fail with `Cannot read properties of undefined (reading 'commands')`. Then add the `contributes` block shown in Step 1 to `package.json` and see it pass.

- [ ] **Step 9: The stub file the vitest alias points at (needed by Step 8's run)**

`test/adapter/vscodeStub.ts` (Task 6 fills it):

```ts
export {};
```

- [ ] **Step 10: Run the gates**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: all pass; `dist/extension.js` exists. `pnpm format` must leave `docs/` unchanged (the docs were formatted when the plan was committed); if it changes anything outside this task's files, stop and look before committing.

- [ ] **Step 11: Prove the purity lint rule works**

Create `src/core/probe.ts` containing `import 'node:fs';`, run `pnpm exec eslint src/core/probe.ts`, expect the error `src/core must stay pure`, then delete the file.

- [ ] **Step 12: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json esbuild.mjs eslint.config.mjs \
  vitest.config.mts .gitignore .vscodeignore src/extension.ts test/adapter
git commit -m "build: scaffold extension with lint, typecheck and unit test gates"
```

---

### Task 2: Destination paths and links (AC6, AC12)

**Files:**

- Create: `src/core/paths.ts`
- Test: `test/core/paths.test.ts`

**Interfaces:**

- Produces:
  - `isAbsoluteDestination(destination: string): boolean`
  - `imageTargetSegments(destination: string, fileName: string): string[]` — path segments relative to the document's folder, may contain `..`
  - `imageLink(destination: string, fileName: string): string` — the Markdown link target

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { imageLink, imageTargetSegments, isAbsoluteDestination } from '../../src/core/paths';

describe('isAbsoluteDestination', () => {
  it.each(['/x', 'C:\\x', 'c:/x', '\\\\server\\share', ' /x'])('rejects %j on every OS', (d) => {
    expect(isAbsoluteDestination(d)).toBe(true);
  });
  it.each(['assets', '../shared/img', '', 'my images', './a'])('accepts %j', (d) => {
    expect(isAbsoluteDestination(d)).toBe(false);
  });
});

describe('imageLink', () => {
  it('joins destination and file name with /', () => {
    expect(imageLink('assets', 'image-c414cd0e.png')).toBe('assets/image-c414cd0e.png');
  });
  it('uses / even for a Windows-style destination', () => {
    expect(imageLink('media\\img\\', 'a.png')).toBe('media/img/a.png');
  });
  it('gives a bare file name for an empty destination, never a root-absolute link', () => {
    expect(imageLink('', 'a.png')).toBe('a.png');
    expect(imageLink('./', 'a.png')).toBe('a.png');
  });
  it('percent-encodes spaces but keeps .. segments', () => {
    expect(imageLink('../my images', 'a.png')).toBe('../my%20images/a.png');
  });
});

describe('imageTargetSegments', () => {
  it('returns unencoded segments for building the target URI', () => {
    expect(imageTargetSegments('../my images/', 'a.png')).toEqual(['..', 'my images', 'a.png']);
    expect(imageTargetSegments('', 'a.png')).toEqual(['a.png']);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm exec vitest run test/core/paths.test.ts` — Expected: FAIL, cannot resolve `../../src/core/paths`.

- [ ] **Step 3: Implement**

```ts
export function isAbsoluteDestination(destination: string): boolean {
  return /^([\\/]|[A-Za-z]:)/.test(destination.trim());
}

function destinationSegments(destination: string): string[] {
  return destination
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
}

export function imageTargetSegments(destination: string, fileName: string): string[] {
  return [...destinationSegments(destination), fileName];
}

export function imageLink(destination: string, fileName: string): string {
  return imageTargetSegments(destination, fileName)
    .map((segment) => (segment === '..' ? segment : encodeURIComponent(segment)))
    .join('/');
}
```

- [ ] **Step 4: Run it and see it pass, then the gates**

Run: `pnpm exec vitest run test/core/paths.test.ts` — Expected: PASS. Then `pnpm format && pnpm lint && pnpm typecheck && pnpm test` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/paths.ts test/core/paths.test.ts
git commit -m "feat(core): compute image target path and markdown link"
```

---

### Task 3: Embedded image decoding and naming (AC5)

**Files:**

- Create: `src/core/images.ts`
- Test: `test/core/images.test.ts`, `test/core/png.ts`

**Interfaces:**

- Produces:
  - `decodeDataUri(src: string): { mime: string; bytes: Uint8Array<ArrayBuffer> } | undefined` — `Uint8Array<ArrayBuffer>`, not plain `Uint8Array`: TypeScript 6 rejects the latter as a `BufferSource` for `crypto.subtle.digest`
  - `extensionForMime(mime: string): string | undefined` — `png`, `jpg`, `gif`, `webp`, `svg`
  - `imageFileName(bytes: Uint8Array<ArrayBuffer>, extension: string): Promise<string>` — `image-<8 hex>.<ext>`

- [ ] **Step 1: Write the shared test image and the failing test**

`test/core/png.ts` — a 1×1 PNG, 70 bytes, shared by core and adapter tests:

```ts
export const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
```

`test/core/images.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeDataUri, extensionForMime, imageFileName } from '../../src/core/images';
import { PNG_BASE64 } from './png';

describe('decodeDataUri', () => {
  it('decodes base64', () => {
    const decoded = decodeDataUri(`data:image/png;base64,${PNG_BASE64}`);
    expect(decoded?.mime).toBe('image/png');
    expect(decoded?.bytes.length).toBe(70);
  });
  it('decodes percent-encoded data', () => {
    const decoded = decodeDataUri('data:image/svg+xml;utf8,%3Csvg%2F%3E');
    expect(decoded?.mime).toBe('image/svg+xml');
    expect(new TextDecoder().decode(decoded?.bytes)).toBe('<svg/>');
  });
  it('lower-cases the MIME type and tolerates whitespace in base64', () => {
    expect(
      decodeDataUri(`data:IMAGE/PNG;base64,${PNG_BASE64.slice(0, 40)}\n${PNG_BASE64.slice(40)}`)
        ?.mime,
    ).toBe('image/png');
  });
  it.each(['data:image/png;base64,@@@', 'data:image/png;utf8,%E0%A4%A', 'nonsense'])(
    'returns undefined for undecodable %j',
    (src) => {
      expect(decodeDataUri(src)).toBeUndefined();
    },
  );
});

describe('extensionForMime', () => {
  it('maps the supported types', () => {
    expect(
      ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'].map(extensionForMime),
    ).toEqual(['png', 'jpg', 'gif', 'webp', 'svg']);
  });
  it('returns undefined for anything else', () => {
    expect(extensionForMime('image/bmp')).toBeUndefined();
  });
});

describe('imageFileName', () => {
  it('is the first 8 hex digits of the SHA-256 of the bytes', async () => {
    const bytes = decodeDataUri(`data:image/png;base64,${PNG_BASE64}`)!.bytes;
    expect(await imageFileName(bytes, 'png')).toBe('image-c414cd0e.png');
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm exec vitest run test/core/images.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

export function extensionForMime(mime: string): string | undefined {
  return EXTENSIONS[mime];
}

export function decodeDataUri(
  src: string,
): { mime: string; bytes: Uint8Array<ArrayBuffer> } | undefined {
  const match = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(src);
  if (!match) return undefined;
  const mime = (match[1] ?? '').toLowerCase();
  const parameters = match[2] ?? '';
  const payload = match[3] ?? '';
  try {
    if (!/;base64$/i.test(parameters)) {
      return { mime, bytes: new TextEncoder().encode(decodeURIComponent(payload)) };
    }
    const base64 = payload.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 === 1) return undefined;
    return { mime, bytes: Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)) };
  } catch {
    return undefined;
  }
}

export async function imageFileName(
  bytes: Uint8Array<ArrayBuffer>,
  extension: string,
): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hash = Array.from(digest.slice(0, 4), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  return `image-${hash}.${extension}`;
}
```

- [ ] **Step 4: Run it and see it pass, then the gates**

Run: `pnpm exec vitest run test/core/images.test.ts` — Expected: PASS. Then `pnpm format && pnpm lint && pnpm typecheck && pnpm test` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/images.ts test/core/images.test.ts test/core/png.ts
git commit -m "feat(core): decode embedded images and name them by content hash"
```

---

### Task 4: The conversion seam (AC3, AC4, AC5, AC7, AC13)

This task needs real clipboard captures from the owner (Step 3). Ask for them when the task starts so the wait does not block Steps 1–2.

**Files:**

- Create: `src/core/types.ts`, `src/core/tightLists.ts`, `src/core/html/wordLists.ts`, `src/core/html/clean.ts`, `src/core/html/images.ts`, `src/core/convert.ts`, `src/core/dropped.ts`
- Test: `test/core/convert.test.ts`, `test/core/golden.test.ts`, `test/core/dropped.test.ts`, `test/core/fixtures/<case>/{input.html,expected.md}`

**Interfaces:**

- Consumes: `decodeDataUri`, `extensionForMime`, `imageFileName` (Task 3); `imageLink` (Task 2).
- Produces:

```ts
// src/core/types.ts
export type DropReason = 'unsupported-type' | 'undecodable' | 'unsupported-source' | 'cannot-save';
export interface ConvertOptions {
  imageDestination: string;
  canSaveImages: boolean;
}
export interface ConvertedImage {
  fileName: string;
  bytes: Uint8Array<ArrayBuffer>;
}
export interface DroppedImage {
  source: string;
  reason: DropReason;
}
export interface ConvertResult {
  /** No trailing newline, so it can be pasted mid-line. */
  markdown: string;
  images: ConvertedImage[];
  dropped: DroppedImage[];
}
```

- `convert(html: string, options: ConvertOptions): Promise<ConvertResult>` in `src/core/convert.ts`
- `summarizeDropped(dropped: DroppedImage[]): string | undefined` in `src/core/dropped.ts`

- [ ] **Step 1: Write `src/core/types.ts`** exactly as in the Interfaces block above.

- [ ] **Step 2: Write the golden fixtures**

Each fixture is a folder under `test/core/fixtures/` with `input.html` and `expected.md`. `expected.md` ends with exactly one newline. These files are excluded from Prettier and EditorConfig — write them byte-exact.

`constructs/input.html` (one line, the `\n` inside `<code>` is a real newline):

<!-- prettier-ignore -->
```html
<h1>Title</h1><h2>Sub</h2><p>a <b>bold</b> <i>italic</i> <del>gone</del> <a href="https://example.com/">link</a> <code>code</code></p><hr><blockquote><p>quote</p></blockquote><ul><li>a<ul><li>nested</li><li>second</li></ul></li><li>b</li></ul><ol><li>one</li><li>two</li></ol><ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> todo</li></ul><pre><code class="language-ts">const a = 1;
</code></pre><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table><p>one<br>two</p>
```

`constructs/expected.md`:

<!-- prettier-ignore -->
````markdown
# Title

## Sub

a **bold** _italic_ ~~gone~~ [link](https://example.com/) `code`

---

> quote

- a
  - nested
  - second
- b

1. one
2. two

- [x] done
- [ ] todo

```ts
const a = 1;
```

| A | B |
| - | - |
| 1 | 2 |

one\
two
````

`no-equivalent/input.html`:

<!-- prettier-ignore -->
```html
<script>x()</script><style>p{}</style><!-- c --><p><u>under</u> H<sub>2</sub>O</p><details><summary>More</summary><p>body</p></details><table><tr><th colspan="2">AB</th></tr><tr><td>1</td><td>2</td></tr></table>
```

`no-equivalent/expected.md`:

<!-- prettier-ignore -->
```markdown
under H2O

More

body

| AB |   |
| -- | - |
| 1  | 2 |
```

`google-docs/input.html`:

<!-- prettier-ignore -->
```html
<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:700">bold</span><span style="font-weight:400"> plain </span><span style="font-style:italic">it</span> <span style="font-weight:700;font-style:italic">both</span></p></b>
```

`google-docs/expected.md`:

<!-- prettier-ignore -->
```markdown
**bold** plain _it_ **_both_**
```

`google-docs-list/input.html` (Google Docs puts a nested list next to its parent item, not inside it):

<!-- prettier-ignore -->
```html
<ul><li dir="ltr" aria-level="1"><p dir="ltr" role="presentation"><span>Parser</span></p></li><ul><li dir="ltr" aria-level="2"><p dir="ltr" role="presentation"><span>Faster</span></p></li><li dir="ltr" aria-level="2"><p dir="ltr" role="presentation"><span>Smaller</span></p></li></ul><li dir="ltr" aria-level="1"><p dir="ltr" role="presentation"><span>Editor</span></p></li></ul>
```

`google-docs-list/expected.md`:

<!-- prettier-ignore -->
```markdown
- Parser
  - Faster
  - Smaller
- Editor
```

`nested-table/input.html`:

<!-- prettier-ignore -->
```html
<table><tr><th>H1</th><th>H2</th></tr><tr><td><table><tr><td>in1</td><td>in2</td></tr></table></td><td>2</td></tr></table>
```

`nested-table/expected.md` (the gap between `in1` and `in2` is one tab character):

<!-- prettier-ignore -->
```markdown
| H1      | H2 |
| ------- | -- |
| in1	in2 | 2  |
```

`headerless-table/input.html`:

<!-- prettier-ignore -->
```html
<table><tbody><tr><td><p>Name</p></td><td><p>Value</p></td></tr><tr><td><p>alpha</p></td><td><p>1</p></td></tr></tbody></table>
```

`headerless-table/expected.md`:

<!-- prettier-ignore -->
```markdown
| Name  | Value |
| ----- | ----- |
| alpha | 1     |
```

`word-list/input.html` (Word pastes lists as paragraphs with a literal marker; keep the blank lines between paragraphs):

<!-- prettier-ignore -->
```html
<p class=MsoNormal>Intro<o:p></o:p></p>

<p class=MsoListParagraphCxSpFirst style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp; </span></span><![endif]>Item one<o:p></o:p></p>

<p class=MsoListParagraphCxSpMiddle style='text-indent:-.25in;mso-list:l0 level2 lfo1'><![if !supportLists]><span style='font-family:"Courier New";mso-list:Ignore'>o<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span><![endif]>Nested <b>bold</b><o:p></o:p></p>

<p class=MsoListParagraphCxSpMiddle style='text-indent:-.25in;mso-list:l0 level2 lfo1'><![if !supportLists]><span style='font-family:"Courier New";mso-list:Ignore'>o<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span><![endif]>Nested two<o:p></o:p></p>

<p class=MsoListParagraphCxSpLast style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp; </span></span><![endif]>Item two<o:p></o:p></p>

<p class=MsoNormal>Between<o:p></o:p></p>

<p class=MsoListParagraphCxSpFirst style='text-indent:-.25in;mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>1.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp; </span></span><![endif]>First<o:p></o:p></p>

<p class=MsoListParagraphCxSpLast style='text-indent:-.25in;mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>2.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp; </span></span><![endif]>Second<o:p></o:p></p>

<p class=MsoNormal>End</p>
```

`word-list/expected.md`:

<!-- prettier-ignore -->
```markdown
Intro

- Item one
  - Nested **bold**
  - Nested two
- Item two

Between

1. First
2. Second

End
```

`word/input.html`:

<!-- prettier-ignore -->
```html
<p class=MsoNormal style="mso-margin-top-alt:auto">Hi<o:p></o:p></p><!--[if gte mso 9]><xml>x</xml><![endif]-->
```

`word/expected.md`:

<!-- prettier-ignore -->
```markdown
Hi
```

`notion/input.html`:

<!-- prettier-ignore -->
```html
<meta charset='utf-8'><h2>Plan</h2><ul><li>one</li><li>two</li></ul><p>Done <a href="https://www.notion.so/x">link</a></p>
```

`notion/expected.md`:

<!-- prettier-ignore -->
```markdown
## Plan

- one
- two

Done [link](https://www.notion.so/x)
```

`remote-image/input.html`:

<!-- prettier-ignore -->
```html
<p><img src="https://e.com/a.png" alt="x"><img src="https://e.com/b.png"></p>
```

`remote-image/expected.md`:

<!-- prettier-ignore -->
```markdown
![x](https://e.com/a.png)![](https://e.com/b.png)
```

These are minimal reproductions of each source's known artifacts; Step 3 adds the real thing.

- [ ] **Step 3: Add real captures from the owner (AC13)**

The owner creates the same sample document in **Word**, **Google Docs** and **Notion**, using each application's own formatting tools (not typed Markdown):

- Heading 1: `Release notes`
- A paragraph: `This is bold, italic and a link.` — with the word `bold` in bold, `italic` in italics, and `link` linked to `https://example.com/`
- Heading 2: `Changes`
- A bullet list: `Parser`, with two sub-bullets `Faster` and `Smaller`; then `Editor`
- A numbered list: `Install`, `Run`
- A table, 2 columns × 3 rows: `Name` / `Value`, `alpha` / `1`, `beta` / `2`

In each application the owner selects the whole sample, copies it, and runs on macOS:

```bash
osascript -e 'the clipboard as «class HTML»' | sed 's/«data HTML//; s/»//' | xxd -r -p > input.html
```

Save each as `test/core/fixtures/real-word/input.html`, `real-google-docs/input.html`, `real-notion/input.html`, byte-exact (these folders are excluded from Prettier, EditorConfig and line-ending conversion). All three share this `expected.md`, which states what the sample visibly contains — it is not produced by running the converter:

```markdown
# Release notes

This is **bold**, _italic_ and a [link](https://example.com/).

## Changes

- Parser
  - Faster
  - Smaller
- Editor

1. Install
2. Run

| Name  | Value |
| ----- | ----- |
| alpha | 1     |
| beta  | 2     |
```

Before committing the captures, search them for `file:///`, user names, e-mail addresses and document ids (Word writes local paths into `<link rel=File-List href="file:///…">` and its metadata; Google Docs writes a `docs-internal-guid`). Redact those values in place — head metadata does not affect the expected output — and show the owner the result: the repository is pushed to GitHub.

The real fixtures may fail after Steps 6–9 in ways the synthetic ones do not. Every such difference is either a cleanup rule on the HTML tree (`src/core/html/`) or a fix on the Markdown tree (next to `src/core/tightLists.ts`), added test-first (the failing real fixture is the test). If a difference cannot be fixed without changing an acceptance criterion, stop and ask the owner.

- [ ] **Step 3b: Write the failing golden test**

`test/core/golden.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { convert } from '../../src/core/convert';

const fixtures = new URL('./fixtures/', import.meta.url);

describe('golden fixtures', () => {
  // directories only: macOS drops .DS_Store files here
  const names = readdirSync(fixtures, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const name of names) {
    it(name, async () => {
      const html = readFileSync(new URL(`${name}/input.html`, fixtures), 'utf8');
      const expected = readFileSync(new URL(`${name}/expected.md`, fixtures), 'utf8');
      const result = await convert(html, { imageDestination: 'assets', canSaveImages: true });
      expect(`${result.markdown}\n`).toBe(expected);
    });
  }
});
```

- [ ] **Step 4: Write the failing image and dropped-reason tests**

`test/core/convert.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { convert } from '../../src/core/convert';
import { PNG_BASE64 } from './png';

const save = { imageDestination: 'assets', canSaveImages: true };
const png = `data:image/png;base64,${PNG_BASE64}`;

describe('convert: embedded images', () => {
  it('links an embedded image, returns its bytes once, and keeps alt text', async () => {
    const result = await convert(
      `<p>a <img alt="pic" src="${png}"> b <img src="${png}"></p>`,
      save,
    );
    expect(result.markdown).toBe(
      'a ![pic](assets/image-c414cd0e.png) b ![](assets/image-c414cd0e.png)',
    );
    expect(result.images.map((image) => [image.fileName, image.bytes.length])).toEqual([
      ['image-c414cd0e.png', 70],
    ]);
    expect(result.dropped).toEqual([]);
  });

  it('saves a percent-encoded SVG', async () => {
    const result = await convert('<img alt="s" src="data:image/svg+xml;utf8,%3Csvg%2F%3E">', save);
    expect(result.images.map((image) => image.fileName)).toEqual([
      expect.stringMatching(/^image-[0-9a-f]{8}\.svg$/),
    ]);
  });

  it('uses the destination in the link', async () => {
    const result = await convert(`<img src="${png}">`, {
      imageDestination: '..\\my images\\',
      canSaveImages: true,
    });
    expect(result.markdown).toBe('![](../my%20images/image-c414cd0e.png)');
  });

  it('drops images it cannot handle and says why, keeping the rest', async () => {
    const result = await convert(
      `<p>x<img src="data:image/bmp;base64,AAAA"><img src="data:image/png;base64,@@@"><img src="file:///C:/t/a.png"><img src="blob:https://x/1"><img src="cid:1"><img src="rel/a.png"></p>`,
      save,
    );
    expect(result.markdown).toBe('x');
    expect(result.images).toEqual([]);
    expect(result.dropped.map((d) => d.reason)).toEqual([
      'unsupported-type',
      'undecodable',
      'unsupported-source',
      'unsupported-source',
      'unsupported-source',
      'unsupported-source',
    ]);
  });

  it('drops embedded images when they cannot be saved (untitled document)', async () => {
    const result = await convert(`<p>x<img src="${png}"></p>`, {
      imageDestination: 'assets',
      canSaveImages: false,
    });
    expect(result.markdown).toBe('x');
    expect(result.dropped).toEqual([{ source: png.slice(0, 40), reason: 'cannot-save' }]);
  });

  it('never drops a remote image, even when images cannot be saved', async () => {
    const result = await convert('<img alt="x" src="https://e.com/a.png">', {
      imageDestination: 'assets',
      canSaveImages: false,
    });
    expect(result.markdown).toBe('![x](https://e.com/a.png)');
  });
});
```

`test/core/dropped.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { summarizeDropped } from '../../src/core/dropped';

describe('summarizeDropped', () => {
  it('is undefined when nothing was dropped', () => {
    expect(summarizeDropped([])).toBeUndefined();
  });
  it('summarizes all dropped images in one message, grouped by reason', () => {
    expect(
      summarizeDropped([
        { source: 'a', reason: 'unsupported-source' },
        { source: 'b', reason: 'unsupported-source' },
        { source: 'c', reason: 'cannot-save' },
      ]),
    ).toBe(
      'Paste as Markdown: 3 images were not pasted (2 from a source that cannot be linked, 1 embedded image that cannot be saved because the document has no folder).',
    );
  });
  it('uses the singular for one image', () => {
    expect(summarizeDropped([{ source: 'a', reason: 'unsupported-type' }])).toBe(
      'Paste as Markdown: 1 image was not pasted (1 of an unsupported type).',
    );
  });
});
```

- [ ] **Step 5: Run and see all three fail**

Run: `pnpm test:unit` — Expected: FAIL, modules not found.

- [ ] **Step 6: Implement `src/core/html/wordLists.ts`**

```ts
import type { Element, ElementContent, Nodes, Root } from 'hast';
import { visit } from 'unist-util-visit';

interface ListItem {
  level: number;
  ordered: boolean;
  children: ElementContent[];
}

interface Frame {
  level: number;
  list: Element | undefined;
  lastItem: Element | undefined;
}

const styleOf = (node: Element): string =>
  String(node.properties['style'] ?? '')
    .toLowerCase()
    .replace(/\s+/g, '');

const textOf = (node: Nodes): string =>
  node.type === 'text' ? node.value : 'children' in node ? node.children.map(textOf).join('') : '';

const element = (tagName: string, children: ElementContent[]): Element => ({
  type: 'element',
  tagName,
  properties: {},
  children,
});

function isListParagraph(node: ElementContent): node is Element {
  return (
    node.type === 'element' && node.tagName === 'p' && /mso-list:(?!none|skip)/.test(styleOf(node))
  );
}

/** Removes Word's literal marker (`·`, `o`, `1.`) and returns its text. */
function takeMarker(paragraph: Element): string {
  let marker = '';
  visit(paragraph, 'element', (node, index, parent) => {
    if (!parent || index === undefined || !/mso-list:ignore/.test(styleOf(node))) return undefined;
    marker = textOf(node);
    parent.children.splice(index, 1);
    return false;
  });
  return marker.trim();
}

function buildLists(items: ListItem[]): Element[] {
  const top: Element[] = [];
  const stack: Frame[] = [{ level: 0, list: undefined, lastItem: undefined }];
  for (const item of items) {
    while (stack.length > 1 && (stack.at(-1)?.level ?? 0) > item.level) stack.pop();
    let frame = stack.at(-1)!;
    if (frame.level < item.level || !frame.list) {
      const list = element(item.ordered ? 'ol' : 'ul', []);
      if (frame.lastItem) frame.lastItem.children.push(list);
      else top.push(list);
      frame = { level: item.level, list, lastItem: undefined };
      stack.push(frame);
    }
    const listItem = element('li', item.children);
    frame.list!.children.push(listItem);
    frame.lastItem = listItem;
  }
  return top;
}

/** Word pastes a list as consecutive `<p style="mso-list:l0 level1 lfo1">` paragraphs. */
export function rebuildWordLists(tree: Root): void {
  visit(tree, (parent) => {
    if (!('children' in parent)) return;
    const rebuilt: ElementContent[] = [];
    let run: ListItem[] = [];
    const flush = (): void => {
      rebuilt.push(...buildLists(run));
      run = [];
    };
    for (const child of parent.children as ElementContent[]) {
      if (isListParagraph(child)) {
        const level = Number(/mso-list:[^;]*level(\d+)/.exec(styleOf(child))?.[1] ?? 1);
        const marker = takeMarker(child);
        run.push({
          level,
          ordered: /^(\d+|[a-z]{1,3})[.)]/i.test(marker),
          children: child.children,
        });
      } else if (child.type === 'text' && child.value.trim() === '' && run.length > 0) {
        continue; // whitespace between list paragraphs
      } else {
        flush();
        rebuilt.push(child);
      }
    }
    flush();
    (parent.children as ElementContent[]) = rebuilt;
  });
}
```

- [ ] **Step 6b: Implement `src/core/html/clean.ts`**

```ts
import type { Element, ElementContent, Root } from 'hast';
import { SKIP, visit } from 'unist-util-visit';

function styleOf(node: Element): string {
  return String(node.properties['style'] ?? '')
    .toLowerCase()
    .replace(/\s+/g, '');
}

/** Google Docs expresses emphasis as styled spans; one span can carry several. */
function tagsForStyle(style: string): string[] {
  const tags: string[] = [];
  if (/font-weight:(bold|[6-9]00)/.test(style)) tags.push('strong');
  if (/font-style:italic/.test(style)) tags.push('em');
  if (/text-decoration[^;]*line-through/.test(style)) tags.push('del');
  return tags;
}

const isList = (node: ElementContent): node is Element =>
  node.type === 'element' && (node.tagName === 'ul' || node.tagName === 'ol');

/** Google Docs puts a nested list next to its parent item, not inside it. */
function adoptSiblingLists(list: Element): void {
  const children: ElementContent[] = [];
  let lastItem: Element | undefined;
  for (const child of list.children) {
    if (isList(child) && lastItem) lastItem.children.push(child);
    else {
      children.push(child);
      if (child.type === 'element' && child.tagName === 'li') lastItem = child;
    }
  }
  list.children = children;
}

/** Word and Google Docs tables have no header row, but a GFM table must have one. */
function promoteFirstRowToHeader(table: Element): void {
  let hasHeader = false;
  let firstRow: Element | undefined;
  visit(table, 'element', (node) => {
    if (node !== table && node.tagName === 'table') return SKIP;
    if (node.tagName === 'th') hasHeader = true;
    if (node.tagName === 'tr') firstRow ??= node;
    return undefined;
  });
  if (hasHeader || !firstRow) return;
  for (const cell of firstRow.children) {
    if (cell.type === 'element' && cell.tagName === 'td') cell.tagName = 'th';
  }
}

/** Strips source-application markup that would otherwise leak into the Markdown. */
export function clean(tree: Root): void {
  visit(tree, (node, index, parent) => {
    if (!parent || index === undefined) return undefined;
    if (node.type === 'comment') {
      parent.children.splice(index, 1);
      return [SKIP, index];
    }
    if (node.type !== 'element') return undefined;
    // Word's <o:p> and friends
    if (node.tagName.includes(':')) {
      parent.children.splice(index, 1);
      return [SKIP, index];
    }
    const style = styleOf(node);
    // Google Docs wraps the whole clipboard in <b style="font-weight:normal">
    if (node.tagName === 'b' && /font-weight:(normal|400)/.test(style)) {
      parent.children.splice(index, 1, ...node.children);
      return [SKIP, index];
    }
    if (isList(node)) adoptSiblingLists(node);
    if (node.tagName === 'table') promoteFirstRowToHeader(node);
    if (node.tagName === 'span') {
      const [outer, ...inner] = tagsForStyle(style);
      if (outer) {
        node.tagName = outer;
        node.properties = {};
        for (const tagName of inner) {
          node.children = [{ type: 'element', tagName, properties: {}, children: node.children }];
        }
      }
    }
    return undefined;
  });
}
```

- [ ] **Step 7: Implement `src/core/html/images.ts`**

```ts
import type { Element, Parent, Root } from 'hast';
import { visit } from 'unist-util-visit';
import { decodeDataUri, extensionForMime, imageFileName } from '../images';
import { imageLink } from '../paths';
import type { ConvertOptions, ConvertedImage, DropReason, DroppedImage } from '../types';

export interface ImageCollector {
  images: ConvertedImage[];
  dropped: DroppedImage[];
}

export async function rewriteImages(
  tree: Root,
  options: ConvertOptions,
  out: ImageCollector,
): Promise<void> {
  const found: { node: Element; parent: Parent }[] = [];
  visit(tree, 'element', (node, _index, parent) => {
    if (node.tagName === 'img' && parent) found.push({ node, parent });
  });

  for (const { node, parent } of found) {
    const src = String(node.properties['src'] ?? '');
    const drop = (reason: DropReason): void => {
      out.dropped.push({ source: src.slice(0, 40), reason });
      parent.children.splice(parent.children.indexOf(node), 1);
    };

    if (/^https?:\/\//i.test(src)) continue;
    if (!/^data:/i.test(src)) {
      drop('unsupported-source');
      continue;
    }
    const decoded = decodeDataUri(src);
    if (!decoded) {
      drop('undecodable');
      continue;
    }
    const extension = extensionForMime(decoded.mime);
    if (!extension) {
      drop('unsupported-type');
      continue;
    }
    if (!options.canSaveImages) {
      drop('cannot-save');
      continue;
    }
    const fileName = await imageFileName(decoded.bytes, extension);
    if (!out.images.some((image) => image.fileName === fileName)) {
      out.images.push({ fileName, bytes: decoded.bytes });
    }
    node.properties['src'] = imageLink(options.imageDestination, fileName);
  }
}
```

- [ ] **Step 7b: Implement `src/core/tightLists.ts`**

```ts
import type { Root } from 'mdast';
import { visit } from 'unist-util-visit';

/**
 * rehype-remark marks an item as loose as soon as it holds a nested list with two items.
 * An item is loose only when it holds more than one paragraph or another block.
 */
export function tightenLists(tree: Root): void {
  visit(tree, 'listItem', (item) => {
    const [first, ...rest] = item.children;
    item.spread = !(
      (first === undefined || first.type === 'paragraph') &&
      rest.every((child) => child.type === 'list')
    );
  });
  visit(tree, 'list', (list) => {
    list.spread = list.children.some((item) => item.spread);
  });
}
```

Add this case to `test/core/convert.test.ts` so a genuinely loose item stays loose:

```ts
describe('convert: lists', () => {
  it('keeps an item with two paragraphs loose', async () => {
    const result = await convert('<ul><li><p>a</p><p>b</p></li><li>c</li></ul>', save);
    expect(result.markdown).toBe('- a\n\n  b\n\n- c');
  });
});
```

- [ ] **Step 8: Implement `src/core/convert.ts`**

```ts
import type { Root } from 'hast';
import type { Root as MdastRoot } from 'mdast';
import rehypeParse from 'rehype-parse';
import rehypeRemark from 'rehype-remark';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { clean } from './html/clean';
import { type ImageCollector, rewriteImages } from './html/images';
import { rebuildWordLists } from './html/wordLists';
import { tightenLists } from './tightLists';
import type { ConvertOptions, ConvertResult } from './types';

export async function convert(html: string, options: ConvertOptions): Promise<ConvertResult> {
  const collected: ImageCollector = { images: [], dropped: [] };
  const file = await unified()
    .use(rehypeParse, { fragment: true })
    // before clean(): the list markers are found by their mso-list style
    .use(() => (tree: Root) => rebuildWordLists(tree))
    .use(() => (tree: Root) => clean(tree))
    .use(() => (tree: Root) => rewriteImages(tree, options, collected))
    // <u> has no Markdown equivalent: keep its text, not an emphasis
    .use(rehypeRemark, { handlers: { u: (state, node) => state.all(node) } })
    .use(() => (tree: MdastRoot) => tightenLists(tree))
    .use(remarkGfm)
    .use(remarkStringify, {
      bullet: '-',
      emphasis: '_',
      rule: '-',
      fences: true,
      listItemIndent: 'one',
    })
    .process(html);
  return { markdown: String(file).replace(/\n$/, ''), ...collected };
}
```

- [ ] **Step 9: Implement `src/core/dropped.ts`**

```ts
import type { DropReason, DroppedImage } from './types';

const REASON_TEXT: Record<DropReason, (count: number) => string> = {
  'unsupported-source': (n) => `${n} from a source that cannot be linked`,
  'unsupported-type': (n) => `${n} of an unsupported type`,
  undecodable: (n) => `${n} that could not be decoded`,
  'cannot-save': (n) =>
    `${n} embedded ${n === 1 ? 'image' : 'images'} that cannot be saved because the document has no folder`,
};

export function summarizeDropped(dropped: DroppedImage[]): string | undefined {
  if (dropped.length === 0) return undefined;
  const counts = new Map<DropReason, number>();
  for (const { reason } of dropped) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const details = [...counts].map(([reason, count]) => REASON_TEXT[reason](count)).join(', ');
  const subject = dropped.length === 1 ? '1 image was' : `${dropped.length} images were`;
  return `Paste as Markdown: ${subject} not pasted (${details}).`;
}
```

- [ ] **Step 10: Run and see everything pass**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test` — Expected: PASS for every synthetic fixture. Then work through the real captures from Step 3 until they pass too. If `exactOptionalPropertyTypes` rejects a unified typing, apply the Global constraints rule (drop only that flag, record why).

- [ ] **Step 11: Commit**

```bash
git add src/core test/core
git commit -m "feat(core): convert clipboard html to markdown with embedded images"
```

---

### Task 5: E2e tests on macOS, written first (AC1, AC2, AC4–AC11)

These tests are written before the adapter exists and must be seen failing. Nothing is committed in this task; Task 6 commits them together with the code that makes them pass.

**Files:**

- Modify: `package.json` (scripts), `CLAUDE.md` (the `Quality gates:` line)
- Create: `.vscode-test.mjs`, `test/e2e/tsconfig.json`, `test/e2e/clipboard.ts`, `test/e2e/harness.ts`, `test/e2e/pasteAsMarkdown.test.ts`, `test/e2e/normalPaste.test.ts`

**Interfaces:**

- Consumes: the built extension (`pnpm build`), extension id `ltvan.markdown-clipboard`.
- Produces: scripts `test:e2e`, widened `typecheck` and `test`; `seedClipboard(content: ClipboardContent): void` with `interface ClipboardContent { html?: string; text?: string; png?: Buffer }` — Task 7 adds Linux and Windows behind the same signature.

- [ ] **Step 1: Write `.vscode-test.mjs`**

```js
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@vscode/test-cli';

const workspace = mkdtempSync(join(tmpdir(), 'mdclip-ws-'));
// a short user-data path: VS Code's IPC socket path has a ~100 character limit
const userData = mkdtempSync(join(tmpdir(), 'mdclip-ud-'));

export default defineConfig({
  files: 'out/e2e/**/*.test.js',
  workspaceFolder: workspace,
  launchArgs: ['--disable-extensions', '--disable-workspace-trust', `--user-data-dir=${userData}`],
  mocha: { timeout: 30_000 },
});
```

- [ ] **Step 2: Write `test/e2e/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "outDir": "../../out/e2e",
    "rootDir": ".",
    "types": ["node", "mocha", "vscode"]
  },
  "include": ["*.ts"]
}
```

`Node16` still emits CommonJS here because `package.json` has no `"type"` field; TypeScript 6 rejects the older `Node10` resolution.

- [ ] **Step 2b: Widen the scripts in `package.json`**

```json
    "typecheck": "tsc --noEmit && tsc --noEmit -p test/e2e",
    "test:e2e": "pnpm build && tsc -p test/e2e && vscode-test",
    "test": "pnpm test:unit && pnpm test:e2e",
```

- [ ] **Step 3: Write the clipboard helper (macOS)**

`test/e2e/clipboard.ts`:

```ts
import { execFileSync } from 'node:child_process';

export interface ClipboardContent {
  html?: string;
  text?: string;
  png?: Buffer;
}

const hex = (data: Buffer): string => data.toString('hex').toUpperCase();

function seedMac(content: ClipboardContent): void {
  const flavors: string[] = [];
  if (content.html !== undefined)
    flavors.push(`«class HTML»:«data HTML${hex(Buffer.from(content.html))}»`);
  if (content.text !== undefined) flavors.push(`string:${JSON.stringify(content.text)}`);
  if (content.png !== undefined) flavors.push(`«class PNGf»:«data PNGf${hex(content.png)}»`);
  execFileSync('osascript', ['-e', `set the clipboard to {${flavors.join(', ')}}`]);
}

/** Puts exactly the given flavors on the real system clipboard. Test-only. */
export function seedClipboard(content: ClipboardContent): void {
  switch (process.platform) {
    case 'darwin':
      return seedMac(content);
    default:
      throw new Error(`clipboard seeding is not implemented on ${process.platform}`);
  }
}
```

Fixture texts must be single-line ASCII without `"` or `\` so `JSON.stringify` yields a valid AppleScript string.

- [ ] **Step 4: Write the harness**

`test/e2e/harness.ts`:

```ts
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
export const PNG_DATA_URI = `data:image/png;base64,${PNG.toString('base64')}`;
export const PASTE_AS_MARKDOWN = 'markdownClipboard.pasteAsMarkdown';
export const NORMAL_PASTE = 'editor.action.clipboardPasteAction';

export const workspaceRoot = (): string => vscode.workspace.workspaceFolders![0]!.uri.fsPath;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(
  condition: () => boolean,
  what: string,
  timeoutMs = 8000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

/** Negative assertions need time for a wrong edit to land before we look. */
export const settle = (): Promise<void> => sleep(1500);

export async function openFile(
  relativePath: string,
  content: string,
  selections: vscode.Selection[],
): Promise<vscode.TextEditor> {
  const file = path.join(workspaceRoot(), relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  const editor = await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(file),
  );
  editor.selections = selections;
  return editor;
}

export const cursor = (line: number, character: number): vscode.Selection =>
  new vscode.Selection(line, character, line, character);

export async function closeAll(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
}

export interface MessageSpy {
  warnings: string[];
  errors: string[];
  restore(): void;
}

/** VS Code has no API to read notifications; this is the accepted stand-in for "a message is shown". */
export function spyOnMessages(): MessageSpy {
  const window = vscode.window as unknown as Record<string, unknown>;
  const original = { warn: window['showWarningMessage'], error: window['showErrorMessage'] };
  const spy: MessageSpy = {
    warnings: [],
    errors: [],
    restore: () => {
      window['showWarningMessage'] = original.warn;
      window['showErrorMessage'] = original.error;
    },
  };
  window['showWarningMessage'] = async (message: string) => void spy.warnings.push(message);
  window['showErrorMessage'] = async (message: string) => void spy.errors.push(message);
  return spy;
}

export async function setDestination(value: string | undefined): Promise<void> {
  await vscode.workspace
    .getConfiguration('markdownClipboard')
    .update('imageDestination', value, vscode.ConfigurationTarget.Workspace);
}
```

If replacing `vscode.window.showWarningMessage` throws because the object is frozen in the target VS Code version, stop and ask the owner: the alternative (an extension-exported test hook) changes what "user-observable" means for these tests.

- [ ] **Step 5: Write the Paste as Markdown e2e tests**

`test/e2e/pasteAsMarkdown.test.ts`:

```ts
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { seedClipboard } from './clipboard';
import {
  closeAll,
  cursor,
  type MessageSpy,
  openFile,
  PASTE_AS_MARKDOWN,
  PNG,
  PNG_DATA_URI,
  setDestination,
  settle,
  spyOnMessages,
  waitFor,
  workspaceRoot,
} from './harness';

const run = () => vscode.commands.executeCommand(PASTE_AS_MARKDOWN);
const exists = (...segments: string[]) => fs.existsSync(path.join(workspaceRoot(), ...segments));

suite('Paste as Markdown', () => {
  let messages: MessageSpy;
  setup(() => {
    messages = spyOnMessages();
  });
  teardown(async () => {
    messages.restore();
    await setDestination(undefined);
    await closeAll();
  });

  test('AC1: inserts the converted Markdown at the cursor', async () => {
    const editor = await openFile('ac1/cursor.md', 'A\nB\n', [cursor(0, 1)]);
    seedClipboard({ html: '<b>SENTINEL</b>', text: 'SENTINEL' });
    await run();
    await waitFor(() => editor.document.getText() === 'A**SENTINEL**\nB\n', 'converted text');
  });

  test('AC1: replaces the selection', async () => {
    const editor = await openFile('ac1/selection.md', 'A old B\n', [
      new vscode.Selection(0, 2, 0, 5),
    ]);
    seedClipboard({ html: '<i>new</i>', text: 'new' });
    await run();
    await waitFor(() => editor.document.getText() === 'A _new_ B\n', 'replaced selection');
  });

  test('AC1: inserts at every cursor', async () => {
    const editor = await openFile('ac1/multi.md', 'A\nB\n', [cursor(0, 1), cursor(1, 1)]);
    seedClipboard({ html: '<b>X</b>', text: 'X' });
    await run();
    await waitFor(() => editor.document.getText() === 'A**X**\nB**X**\n', 'text at both cursors');
  });

  test('AC4: keeps a remote image as a link and creates no file', async () => {
    const editor = await openFile('ac4/doc.md', '', [cursor(0, 0)]);
    seedClipboard({ html: '<img alt="x" src="https://example.com/a.png">', text: 'x' });
    await run();
    await waitFor(
      () => editor.document.getText() === '![x](https://example.com/a.png)',
      'image link',
    );
    assert.deepStrictEqual(fs.readdirSync(path.join(workspaceRoot(), 'ac4')), ['doc.md']);
  });

  test('AC5: saves an embedded image under assets/ and links it; pasting again reuses the file', async () => {
    const editor = await openFile('ac5/doc.md', '', [cursor(0, 0)]);
    seedClipboard({ html: `<img alt="p" src="${PNG_DATA_URI}">`, text: 'p' });
    await run();
    await waitFor(() => exists('ac5', 'assets', 'image-c414cd0e.png'), 'image file');
    assert.strictEqual(editor.document.getText(), '![p](assets/image-c414cd0e.png)');
    assert.ok(
      fs
        .readFileSync(path.join(workspaceRoot(), 'ac5', 'assets', 'image-c414cd0e.png'))
        .equals(PNG),
    );

    await run();
    await waitFor(
      () => editor.document.getText().split('image-c414cd0e.png').length === 3,
      'second paste',
    );
    assert.deepStrictEqual(fs.readdirSync(path.join(workspaceRoot(), 'ac5', 'assets')), [
      'image-c414cd0e.png',
    ]);
    assert.deepStrictEqual(messages.errors, []);
  });

  test('AC6: honors markdownClipboard.imageDestination', async () => {
    await setDestination('media/img');
    const editor = await openFile('ac6/doc.md', '', [cursor(0, 0)]);
    seedClipboard({ html: `<img src="${PNG_DATA_URI}">`, text: 'p' });
    await run();
    await waitFor(() => exists('ac6', 'media', 'img', 'image-c414cd0e.png'), 'image in media/img');
    assert.strictEqual(editor.document.getText(), '![](media/img/image-c414cd0e.png)');
  });

  test('AC6: rejects an absolute destination with a warning and uses assets/', async () => {
    await setDestination('/absolute/place');
    await openFile('ac6abs/doc.md', '', [cursor(0, 0)]);
    seedClipboard({ html: `<img src="${PNG_DATA_URI}">`, text: 'p' });
    await run();
    await waitFor(() => exists('ac6abs', 'assets', 'image-c414cd0e.png'), 'image in assets');
    assert.strictEqual(messages.warnings.length, 1);
    assert.match(messages.warnings[0]!, /absolute path/);
  });

  test('AC7: in an untitled document, drops embedded images with one warning and pastes the rest', async () => {
    const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: '' });
    await vscode.window.showTextDocument(document);
    seedClipboard({
      html: `<p>kept<img src="${PNG_DATA_URI}"><img src="file:///C:/t/a.png"></p>`,
      text: 'kept',
    });
    await run();
    await waitFor(() => document.getText() === 'kept', 'text without images');
    assert.strictEqual(messages.warnings.length, 1);
    assert.match(messages.warnings[0]!, /2 images were not pasted/);
  });

  test('AC8: with no HTML, pastes the plain text unchanged, in full at each cursor', async () => {
    const editor = await openFile('ac8/plain.md', 'A\nB\n', [cursor(0, 1), cursor(1, 1)]);
    seedClipboard({ text: '*not* converted' });
    await run();
    await waitFor(
      () => editor.document.getText() === 'A*not* converted\nB*not* converted\n',
      'plain text',
    );
  });

  test('AC9(b): when the image cannot be saved, pastes the text, reports the image, and one undo reverts', async function () {
    if (process.platform === 'win32') this.skip(); // chmod cannot make a folder read-only on Windows
    const readOnly = path.join(workspaceRoot(), 'ac9', 'ro');
    fs.mkdirSync(readOnly, { recursive: true });
    fs.chmodSync(readOnly, 0o555);
    try {
      await setDestination('ro');
      const editor = await openFile('ac9/doc.md', '', [cursor(0, 0)]);
      seedClipboard({ html: `<img alt="p" src="${PNG_DATA_URI}">`, text: 'p' });
      await run();
      await waitFor(() => messages.errors.length === 1, 'error message');
      assert.match(messages.errors[0]!, /could not save image-c414cd0e\.png/);
      assert.strictEqual(editor.document.getText(), '![p](ro/image-c414cd0e.png)');
      await vscode.commands.executeCommand('undo');
      await waitFor(() => editor.document.getText() === '', 'undo');
    } finally {
      fs.chmodSync(readOnly, 0o755);
    }
  });

  test('AC10(b): does nothing outside Markdown documents', async () => {
    const editor = await openFile('ac10/note.txt', 'A\n', [cursor(0, 1)]);
    seedClipboard({ html: '<b>SENTINEL</b>', text: 'SENTINEL' });
    await run();
    await settle();
    assert.strictEqual(editor.document.getText(), 'A\n');
    assert.deepStrictEqual(fs.readdirSync(path.join(workspaceRoot(), 'ac10')), ['note.txt']);
  });

  test('AC11: with only a raw image on the clipboard, inserts nothing and creates no file', async () => {
    const editor = await openFile('ac11/doc.md', 'A\n', [cursor(0, 1)]);
    seedClipboard({ png: PNG });
    await run();
    await settle();
    assert.strictEqual(editor.document.getText(), 'A\n');
    assert.deepStrictEqual(fs.readdirSync(path.join(workspaceRoot(), 'ac11')), ['doc.md']);
  });
});
```

- [ ] **Step 6: Write the normal-paste e2e tests**

`test/e2e/normalPaste.test.ts`:

```ts
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { seedClipboard } from './clipboard';
import {
  closeAll,
  cursor,
  NORMAL_PASTE,
  openFile,
  PNG,
  settle,
  waitFor,
  workspaceRoot,
} from './harness';

const paste = () => vscode.commands.executeCommand(NORMAL_PASTE);

suite('Normal paste is never converted (AC2)', () => {
  teardown(closeAll);

  test('HTML + plain text: pastes exactly the plain text', async () => {
    const editor = await openFile('ac2/plain.md', 'A\n', [cursor(0, 1)]);
    seedClipboard({ html: '<b>SENTINEL</b>', text: 'PLAIN' });
    await paste();
    await waitFor(() => editor.document.getText() === 'APLAIN\n', 'plain paste');
  });

  test('HTML only: no converted text appears', async () => {
    const editor = await openFile('ac2/html.md', 'A\n', [cursor(0, 1)]);
    seedClipboard({ html: '<b>SENTINEL</b>' });
    await paste();
    await settle();
    assert.ok(!editor.document.getText().includes('**SENTINEL**'));
  });

  test('HTML + image: no converted text appears', async () => {
    const editor = await openFile('ac2/image.md', 'A\n', [cursor(0, 1)]);
    seedClipboard({ html: '<b>SENTINEL</b>', png: PNG });
    await paste();
    await settle();
    assert.ok(!editor.document.getText().includes('**SENTINEL**'));
  });
});

suite('Raw image paste stays with VS Code (AC11)', () => {
  teardown(closeAll);

  test('a normal paste of an image-only clipboard inserts an image link and saves the image', async () => {
    const editor = await openFile('ac11-normal/doc.md', '', [cursor(0, 0)]);
    seedClipboard({ png: PNG });
    await paste();
    await waitFor(
      () => /!\[[^\]]*\]\([^)]+\.png\)/.test(editor.document.getText()),
      'built-in image link',
    );
    const folder = path.join(workspaceRoot(), 'ac11-normal');
    await waitFor(
      () => fs.readdirSync(folder).some((name) => name.endsWith('.png')),
      'built-in image file',
    );
  });
});
```

- [ ] **Step 7: Run the e2e suite and see it fail for the right reason**

Run: `pnpm format && pnpm lint && pnpm typecheck` — Expected: PASS (the tests compile).

Run: `pnpm test:e2e` — Expected: VS Code is downloaded on first run and a window opens. Do not use the clipboard or keyboard while it runs.

- Every test in the `Paste as Markdown` suite that expects a change FAILS, with `command 'markdownClipboard.pasteAsMarkdown' not found` or `timed out waiting for …`.
- The three `Normal paste is never converted` tests and the `Raw image paste stays with VS Code` test PASS already: they describe VS Code's own behavior, which the extension must not disturb. If one of them fails now, the clipboard helper or a "Verified fact" is wrong — stop and report to the owner before going on.
- The "does nothing" tests (AC10(b), AC11 in the first suite) fail only because the command does not exist.

- [ ] **Step 8: Fill the quality gates line in `CLAUDE.md`**

Replace the `Quality gates:` line with:

```
Quality gates: `pnpm format && pnpm lint && pnpm typecheck && pnpm test` (e2e opens a VS Code window and overwrites the clipboard; `pnpm test:unit` is the fast loop).
```

Do not commit yet.

---

### Task 6: The VS Code adapter (AC2 guard, AC6–AC9, AC10(b))

**Files:**

- Create: `src/vscode/settings.ts`, `src/vscode/imageVerifier.ts`, `src/vscode/pasteProvider.ts`, `src/vscode/pasteCommand.ts`
- Modify: `src/extension.ts`, `test/adapter/vscodeStub.ts`
- Test: `test/adapter/pasteProvider.test.ts`, `test/adapter/imageVerifier.test.ts`, `test/adapter/pasteCommand.test.ts`

**Interfaces:**

- Consumes: `convert`, `summarizeDropped`, `isAbsoluteDestination`, `imageTargetSegments`, types from Tasks 2–4.
- Produces:
  - `DEFAULT_IMAGE_DESTINATION = 'assets'`; `readSettings(resource: vscode.Uri): { imageDestination: string; rejectedDestination?: string }`
  - `class ImageVerifier { constructor(options?: { intervalMs?: number; attempts?: number; armedMs?: number }); expect(document: vscode.TextDocument, insertedText: string, targets: vscode.Uri[]): void }`
  - `PASTE_KIND: vscode.DocumentDropOrPasteEditKind`, `PASTE_METADATA: vscode.DocumentPasteProviderMetadata`, `class PasteAsMarkdownProvider implements vscode.DocumentPasteEditProvider` (constructor takes an `ImageVerifier`)
  - `pasteAsMarkdown(): Promise<void>`

- [ ] **Step 1: Write the `vscode` stub**

`test/adapter/vscodeStub.ts` — only what the adapter touches:

```ts
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
  existingFiles: new Set<string>(),
  fireDidChangeTextDocument(document: unknown, texts: string[]): void {
    for (const listener of [...changeListeners]) {
      listener({ document, contentChanges: texts.map((text) => ({ text })) });
    }
  },
  listenerCount: () => changeListeners.size,
  reset(): void {
    testing.configuration.clear();
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
```

- [ ] **Step 2: Write the failing provider test**

`test/adapter/pasteProvider.test.ts`:

```ts
import * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testing, Uri as StubUri, type WorkspaceEdit } from './vscodeStub';
import { PNG_BASE64 } from '../core/png';
import { ImageVerifier } from '../../src/vscode/imageVerifier';
import {
  PASTE_KIND,
  PASTE_METADATA,
  PasteAsMarkdownProvider,
} from '../../src/vscode/pasteProvider';

const convert = vi.hoisted(() => vi.fn());
vi.mock('../../src/core/convert', async (original) => {
  const actual = await original<typeof import('../../src/core/convert')>();
  convert.mockImplementation(actual.convert);
  return { convert };
});

function transfer(flavors: Record<string, string>): vscode.DataTransfer {
  return {
    get: (mime: string) => (mime in flavors ? { asString: async () => flavors[mime] } : undefined),
  } as unknown as vscode.DataTransfer;
}
const savedDoc = { uri: vscode.Uri.file('/ws/notes/doc.md') } as vscode.TextDocument;
const untitledDoc = { uri: StubUri.untitled('Untitled-1') } as unknown as vscode.TextDocument;
const pasteAs: vscode.DocumentPasteEditContext = {
  triggerKind: vscode.DocumentPasteTriggerKind.PasteAs,
  only: PASTE_KIND,
};
const automatic: vscode.DocumentPasteEditContext = {
  triggerKind: vscode.DocumentPasteTriggerKind.Automatic,
  only: undefined,
};
const token = {} as vscode.CancellationToken;
const png = `data:image/png;base64,${PNG_BASE64}`;

describe('PasteAsMarkdownProvider', () => {
  let verifier: ImageVerifier;
  let provider: PasteAsMarkdownProvider;
  const provide = (
    doc: vscode.TextDocument,
    flavors: Record<string, string>,
    context: vscode.DocumentPasteEditContext = pasteAs,
  ) => provider.provideDocumentPasteEdits(doc, [], transfer(flavors), context, token);

  beforeEach(() => {
    testing.reset();
    verifier = new ImageVerifier();
    vi.spyOn(verifier, 'expect');
    provider = new PasteAsMarkdownProvider(verifier);
  });

  it('declares its kind and reads html and plain text', () => {
    expect(PASTE_KIND.value).toBe('markdown.fromHtml');
    expect(PASTE_METADATA.providedPasteEditKinds).toEqual([PASTE_KIND]);
    expect(PASTE_METADATA.pasteMimeTypes).toEqual(['text/html', 'text/plain']);
  });

  it.each([
    ['html only', { 'text/html': '<b>SENTINEL</b>' }],
    ['html + plain', { 'text/html': '<b>SENTINEL</b>', 'text/plain': 'SENTINEL' }],
    ['html + image', { 'text/html': '<b>SENTINEL</b>', 'image/png': 'x' }],
  ])('returns nothing for a normal paste (%s)', async (_name, flavors) => {
    expect(await provide(savedDoc, flavors, automatic)).toBeUndefined();
  });

  it('converts html on an explicit paste-as and yields to plain text', async () => {
    const edits = await provide(savedDoc, {
      'text/html': '<b>SENTINEL</b>',
      'text/plain': 'SENTINEL',
    });
    expect(edits).toHaveLength(1);
    expect(edits![0]!.insertText).toBe('**SENTINEL**');
    expect(edits![0]!.kind).toBe(PASTE_KIND);
    expect(edits![0]!.yieldTo).toEqual([vscode.DocumentDropOrPasteEditKind.Text]);
    expect(edits![0]!.additionalEdit).toBeUndefined();
  });

  it('falls back to the plain text, unchanged, when there is no html', async () => {
    const edits = await provide(savedDoc, { 'text/plain': 'L1\nL2' });
    expect(edits![0]!.insertText).toBe('L1\nL2');
  });

  it('returns nothing when there is neither html nor plain text', async () => {
    expect(await provide(savedDoc, { 'image/png': 'x' })).toBeUndefined();
  });

  it('creates embedded images next to the document without overwriting, and arms the verifier', async () => {
    const edits = await provide(savedDoc, { 'text/html': `<img alt="p" src="${png}">` });
    expect(edits![0]!.insertText).toBe('![p](assets/image-c414cd0e.png)');
    const created = (edits![0]!.additionalEdit as unknown as WorkspaceEdit).created;
    expect(created.map((c) => c.uri.toString())).toEqual([
      'file:/ws/notes/assets/image-c414cd0e.png',
    ]);
    expect(created[0]!.options.ignoreIfExists).toBe(true);
    expect(created[0]!.options.contents?.length).toBe(70);
    expect(verifier.expect).toHaveBeenCalledWith(savedDoc, '![p](assets/image-c414cd0e.png)', [
      created[0]!.uri,
    ]);
  });

  it('honors the destination setting', async () => {
    testing.configuration.set('markdownClipboard.imageDestination', '../media');
    const edits = await provide(savedDoc, { 'text/html': `<img src="${png}">` });
    expect(edits![0]!.insertText).toBe('![](../media/image-c414cd0e.png)');
    const created = (edits![0]!.additionalEdit as unknown as WorkspaceEdit).created;
    expect(created[0]!.uri.toString()).toBe('file:/ws/media/image-c414cd0e.png');
  });

  it('rejects an absolute destination: uses the default and warns', async () => {
    testing.configuration.set('markdownClipboard.imageDestination', 'C:\\img');
    const edits = await provide(savedDoc, { 'text/html': `<img src="${png}">` });
    expect(edits![0]!.insertText).toBe('![](assets/image-c414cd0e.png)');
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Paste as Markdown: "C:\\img" is an absolute path, so images go to "assets" instead. Set markdownClipboard.imageDestination to a path relative to the document.',
    );
  });

  it('drops embedded images in an untitled document with one warning, and pastes the rest', async () => {
    const edits = await provide(untitledDoc, {
      'text/html': `<p>text<img src="${png}"><img src="cid:1"></p>`,
    });
    expect(edits![0]!.insertText).toBe('text');
    expect(edits![0]!.additionalEdit).toBeUndefined();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Paste as Markdown: 2 images were not pasted (1 embedded image that cannot be saved because the document has no folder, 1 from a source that cannot be linked).',
    );
    expect(verifier.expect).not.toHaveBeenCalled();
  });

  it('shows an error and returns no edit when conversion throws', async () => {
    convert.mockRejectedValueOnce(new Error('boom'));
    expect(await provide(savedDoc, { 'text/html': '<p>x</p>' })).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Paste as Markdown failed: boom');
  });
});
```

- [ ] **Step 3: Write the failing verifier test**

`test/adapter/imageVerifier.test.ts`:

```ts
import * as vscode from 'vscode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testing } from './vscodeStub';
import { ImageVerifier } from '../../src/vscode/imageVerifier';

const doc = { uri: vscode.Uri.file('/ws/doc.md') } as vscode.TextDocument;
const target = vscode.Uri.file('/ws/assets/image-c414cd0e.png');
const options = { intervalMs: 10, attempts: 3, armedMs: 1000 };

describe('ImageVerifier', () => {
  beforeEach(() => {
    testing.reset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('stays silent when the files exist after the paste lands', async () => {
    new ImageVerifier(options).expect(doc, 'TEXT', [target]);
    testing.existingFiles.add(target.toString());
    testing.fireDidChangeTextDocument(doc, ['TEXT']);
    await vi.runAllTimersAsync();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(testing.listenerCount()).toBe(0);
  });

  it('names the missing images and suggests undo when they never appear', async () => {
    new ImageVerifier(options).expect(doc, 'TEXT', [target]);
    testing.fireDidChangeTextDocument(doc, ['TEXT']);
    await vi.runAllTimersAsync();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Paste as Markdown: could not save image-c414cd0e.png. The text was pasted; undo to revert it.',
    );
  });

  it('matches the inserted text regardless of line endings, once, even with several cursors', async () => {
    new ImageVerifier(options).expect(doc, 'A\nB', [target]);
    testing.fireDidChangeTextDocument(doc, ['A\r\nB', 'A\r\nB']);
    await vi.runAllTimersAsync();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
  });

  it('ignores other edits and other documents, and disarms itself if the edit is never applied', async () => {
    new ImageVerifier(options).expect(doc, 'TEXT', [target]);
    testing.fireDidChangeTextDocument(doc, ['typing']);
    testing.fireDidChangeTextDocument({}, ['TEXT']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(testing.listenerCount()).toBe(0);
  });
});
```

- [ ] **Step 4: Write the failing command test**

`test/adapter/pasteCommand.test.ts`:

```ts
import * as vscode from 'vscode';
import { beforeEach, describe, expect, it } from 'vitest';
import { testing, window as stubWindow } from './vscodeStub';
import { pasteAsMarkdown } from '../../src/vscode/pasteCommand';

describe('pasteAsMarkdown', () => {
  beforeEach(() => testing.reset());

  it('runs paste-as with our kind in a Markdown editor', async () => {
    stubWindow.activeTextEditor = { document: { languageId: 'markdown' } };
    await pasteAsMarkdown();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('editor.action.pasteAs', {
      kind: 'markdown.fromHtml',
    });
  });

  it.each([undefined, { document: { languageId: 'plaintext' } }])(
    'does nothing for %j',
    async (editor) => {
      stubWindow.activeTextEditor = editor;
      await pasteAsMarkdown();
      expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    },
  );
});
```

- [ ] **Step 5: Run and see them fail**

Run: `pnpm test:unit` — Expected: FAIL, `src/vscode/*` modules not found.

- [ ] **Step 6: Implement `src/vscode/settings.ts`**

```ts
import * as vscode from 'vscode';
import { isAbsoluteDestination } from '../core/paths';

export const DEFAULT_IMAGE_DESTINATION = 'assets';

export interface Settings {
  imageDestination: string;
  rejectedDestination?: string;
}

export function readSettings(resource: vscode.Uri): Settings {
  const configured = vscode.workspace
    .getConfiguration('markdownClipboard', resource)
    .get<string>('imageDestination', DEFAULT_IMAGE_DESTINATION);
  if (isAbsoluteDestination(configured)) {
    return { imageDestination: DEFAULT_IMAGE_DESTINATION, rejectedDestination: configured };
  }
  return { imageDestination: configured };
}
```

- [ ] **Step 7: Implement `src/vscode/imageVerifier.ts`**

```ts
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
```

- [ ] **Step 8: Implement `src/vscode/pasteProvider.ts`**

```ts
import * as vscode from 'vscode';
import { convert } from '../core/convert';
import { summarizeDropped } from '../core/dropped';
import { imageTargetSegments } from '../core/paths';
import type { ImageVerifier } from './imageVerifier';
import { DEFAULT_IMAGE_DESTINATION, readSettings } from './settings';

export const PASTE_KIND = vscode.DocumentDropOrPasteEditKind.Empty.append('markdown', 'fromHtml');

export const PASTE_METADATA: vscode.DocumentPasteProviderMetadata = {
  providedPasteEditKinds: [PASTE_KIND],
  pasteMimeTypes: ['text/html', 'text/plain'],
};

const TITLE = 'Paste as Markdown';

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

    const settings = readSettings(document.uri);
    if (settings.rejectedDestination !== undefined) {
      void vscode.window.showWarningMessage(
        `Paste as Markdown: "${settings.rejectedDestination}" is an absolute path, so images go to "${DEFAULT_IMAGE_DESTINATION}" instead. Set markdownClipboard.imageDestination to a path relative to the document.`,
      );
    }

    let result;
    try {
      result = await convert(html, {
        imageDestination: settings.imageDestination,
        canSaveImages: document.uri.scheme !== 'untitled',
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
```

- [ ] **Step 9: Implement `src/vscode/pasteCommand.ts` and `src/extension.ts`**

`src/vscode/pasteCommand.ts`:

```ts
import * as vscode from 'vscode';
import { PASTE_KIND } from './pasteProvider';

export async function pasteAsMarkdown(): Promise<void> {
  if (vscode.window.activeTextEditor?.document.languageId !== 'markdown') return;
  await vscode.commands.executeCommand('editor.action.pasteAs', { kind: PASTE_KIND.value });
}
```

`src/extension.ts`:

```ts
import * as vscode from 'vscode';
import { ImageVerifier } from './vscode/imageVerifier';
import { pasteAsMarkdown } from './vscode/pasteCommand';
import { PASTE_METADATA, PasteAsMarkdownProvider } from './vscode/pasteProvider';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerDocumentPasteEditProvider(
      { language: 'markdown' },
      new PasteAsMarkdownProvider(new ImageVerifier()),
      PASTE_METADATA,
    ),
    vscode.commands.registerCommand('markdownClipboard.pasteAsMarkdown', pasteAsMarkdown),
  );
}
```

- [ ] **Step 10: Run the unit gates**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` — Expected: PASS.

- [ ] **Step 11: Run the e2e suite from Task 5 and see it pass**

Run: `pnpm test:e2e` — Expected: all tests pass (AC9(b) is skipped only on Windows). Do not use the clipboard or keyboard while it runs.

If a test fails because VS Code behaves differently from the spec's "Verified facts", stop and report to the owner before changing any assertion.

- [ ] **Step 12: Commit the code, then the e2e tests**

```bash
git add src test/adapter
git commit -m "feat: add paste as markdown command and paste edit provider"
git add package.json .vscode-test.mjs test/e2e CLAUDE.md
git commit -m "test: add e2e tests for paste as markdown on macOS"
```

- [ ] **Step 13: Review checkpoint**

Before going on: a code review and a security review of the branch's diff, with the owner weighing the findings. Security-relevant surface: SVG saved verbatim, `..` in the image destination, file names derived from content hashes only, no network access in the core.

---

### Task 7: Linux and Windows clipboard seeding, CI matrix (AC14)

Clipboard seeding is proven on macOS only. This task proves it on the other two: first on the owner's Linux and Windows machines (ask the owner how to reach them; do not write host names or paths into the repository), then in CI.

**Files:**

- Create: `.github/workflows/ci.yml`, `test/e2e/seed-windows.ps1`
- Modify: `test/e2e/clipboard.ts`

**Interfaces:**

- Consumes: `seedClipboard(content: ClipboardContent): void` (Task 5) — the signature does not change.

- [ ] **Step 1: Add the Windows helper**

`test/e2e/seed-windows.ps1` — reads a JSON file `{ html?, text?, pngBase64? }`; must run with `-STA`:

```powershell
param([Parameter(Mandatory = $true)][string]$SpecPath)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$spec = Get-Content -Raw -Path $SpecPath | ConvertFrom-Json
$data = New-Object System.Windows.Forms.DataObject
if ($null -ne $spec.html) {
  $fragment = "<html><body><!--StartFragment-->$($spec.html)<!--EndFragment--></body></html>"
  $header = "Version:0.9`r`nStartHTML:{0:D10}`r`nEndHTML:{1:D10}`r`nStartFragment:{2:D10}`r`nEndFragment:{3:D10}`r`n"
  $headerLength = ($header -f 0, 0, 0, 0).Length
  $startFragment = $headerLength + $fragment.IndexOf('<!--StartFragment-->') + 20
  $endFragment = $headerLength + $fragment.IndexOf('<!--EndFragment-->')
  $cfHtml = ($header -f $headerLength, ($headerLength + $fragment.Length), $startFragment, $endFragment) + $fragment
  $data.SetData([System.Windows.Forms.DataFormats]::Html, $cfHtml)
}
if ($null -ne $spec.text) { $data.SetData([System.Windows.Forms.DataFormats]::UnicodeText, $spec.text) }
if ($null -ne $spec.pngBase64) {
  $stream = New-Object System.IO.MemoryStream (, [Convert]::FromBase64String($spec.pngBase64))
  $data.SetImage([System.Drawing.Image]::FromStream($stream))
}
[System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
```

Offsets are character counts, which equal byte counts only for ASCII — another reason fixtures stay ASCII.

- [ ] **Step 2: Add the Windows and Linux branches to `test/e2e/clipboard.ts`**

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function seedWindows(content: ClipboardContent): void {
  const spec = join(mkdtempSync(join(tmpdir(), 'mdclip-seed-')), 'spec.json');
  writeFileSync(
    spec,
    JSON.stringify({
      html: content.html,
      text: content.text,
      pngBase64: content.png?.toString('base64'),
    }),
  );
  // out/e2e/clipboard.js → test/e2e/seed-windows.ps1
  const script = join(__dirname, '..', '..', 'test', 'e2e', 'seed-windows.ps1');
  execFileSync('powershell.exe', [
    '-NoProfile',
    '-STA',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    script,
    '-SpecPath',
    spec,
  ]);
}

function seedLinux(content: ClipboardContent): void {
  // xclip can offer only one target per selection, so CopyQ (multi-format) owns the clipboard
  const parts: string[] = [];
  if (content.html !== undefined) parts.push(`'text/html', ${JSON.stringify(content.html)}`);
  if (content.text !== undefined) parts.push(`'text/plain', ${JSON.stringify(content.text)}`);
  if (content.png !== undefined)
    parts.push(`'image/png', fromBase64(${JSON.stringify(content.png.toString('base64'))})`);
  execFileSync('copyq', ['eval', `copy(${parts.join(', ')})`]);
}
```

and extend the `switch`:

```ts
    case 'win32':
      return seedWindows(content);
    case 'linux':
      return seedLinux(content);
```

- [ ] **Step 3: Gates, commit, and ask before pushing**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add test/e2e/clipboard.ts test/e2e/seed-windows.ps1
git commit -m "test: seed the clipboard on Linux and Windows"
```

Pushing publishes the branch. Confirm with the owner, then `git push -u origin feat/paste-as-markdown` so the other machines can check it out.

- [ ] **Step 3b: Prove both helpers on the owner's machines**

On each machine: check out the branch, `pnpm install --frozen-lockfile`, then `pnpm lint && pnpm typecheck && pnpm test:unit`, then the e2e suite — on Linux `xvfb-run -a bash -c 'copyq --start-server >/dev/null 2>&1 & until copyq eval true >/dev/null 2>&1; do sleep 0.2; done; pnpm test:e2e'`; on Windows `pnpm test:e2e` from an interactive desktop session (a remote shell without a desktop has no clipboard and cannot show the VS Code window — if that is all that is available, say so to the owner rather than skipping).

Expected: the same results as on macOS, with AC9(b) skipped on Windows. Step 6's rules apply to any failure.

- [ ] **Step 4: Write the CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
  pull_request:

jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: No line-ending diffs after checkout
        run: git diff --exit-code
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test:unit
      - name: E2e (Linux)
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update && sudo apt-get install -y xvfb copyq
          xvfb-run -a bash -c 'copyq --start-server >/dev/null 2>&1 & until copyq eval true >/dev/null 2>&1; do sleep 0.2; done; pnpm test:e2e'
      - name: E2e (macOS, Windows)
        if: runner.os != 'Linux'
        run: pnpm test:e2e
```

- [ ] **Step 5: Commit the workflow, push, and read the CI result**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run lint, typecheck and tests on macOS, Linux and Windows"
git push
gh run watch
```

Expected: three green jobs.

- [ ] **Step 6: If seeding fails on an OS, diagnose, then ask**

Add a temporary step printing the clipboard's formats after a seed (Linux: `copyq clipboard '?'`; Windows: `powershell -STA -Command "Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.Clipboard]::GetDataObject().GetFormats()"`) to tell a seeding failure from a VS Code behavior difference. Fix the helper if it is a helper bug. If a clipboard shape cannot be seeded on an OS at all, **stop and ask the owner** before skipping or downgrading any e2e case on that OS — the spec forbids doing so unasked. If VS Code behaves differently from the spec's "Verified facts" on an OS, that also goes to the owner.

- [ ] **Step 7: Only if Step 6 changed anything — remove temporary diagnostics, confirm green, commit**

```bash
git add .github/workflows/ci.yml test/e2e
git commit -m "test: fix clipboard seeding on Linux and Windows"
git push
```

---

### Task 8: Documentation

**Files:**

- Create: `docs/design-specs/extension.md`, `README.md`
- Modify: this plan's `Status:` line

- [ ] **Step 1: Write `docs/design-specs/extension.md`**

````markdown
# Extension design

Last updated: 2026-09-20

How the extension is currently built. Decisions and their history live in `docs/specs/`.

## Layers

```
src/extension.ts   composition root: registers the provider and the command
src/vscode/        adapter — the only code that imports 'vscode'
src/core/          pure TypeScript: no 'vscode', no file system, no network
```

- ESLint enforces the core's purity (`eslint.config.mjs`): it may not import `vscode`, `fs`, `http`, `https`, `net`, nor use `fetch`.
- The seam is `convert(html, options) → { markdown, images[], dropped[] }` in `src/core/convert.ts`. The core returns image bytes and names; the adapter decides where files go.
- The conversion engine (unified: rehype-parse → rehype-remark → remark-gfm → remark-stringify) is an implementation detail of `convert()`.

## Cross-cutting rules

- **A normal paste is never altered.** The paste provider returns nothing unless the trigger is an explicit Paste As. Every new paste feature keeps this guard.
- **One atomic edit.** Text and created files travel in one `DocumentPasteEdit`, so one undo reverts both. VS Code applies the text even when a file cannot be created, so `ImageVerifier` checks the files after the paste lands and reports the missing ones.
- **Failures are never silent.** Dropped images produce one warning; conversion and file failures produce an error.
- **Paths.** Image links always use `/` and are percent-encoded; absolute destinations are rejected host-independently (`src/core/paths.ts`).

## Tests

- `test/core/` — unit tests and golden fixtures (`input.html` / `expected.md`). Every conversion bug becomes a new fixture. Fixtures are byte-exact: excluded from Prettier, EditorConfig and Git line-ending conversion.
- `test/adapter/` — the adapter against a stubbed `vscode` module (`test/adapter/vscodeStub.ts`).
- `test/e2e/` — inside VS Code, asserting user-observable behavior only. They seed the real system clipboard (`test/e2e/clipboard.ts`: `osascript` on macOS, PowerShell on Windows, CopyQ on Linux because `xclip` can offer only one format at a time) and wait by polling, because `editor.action.pasteAs` resolves before the edit is applied.

## Known behavior

- VS Code calls the provider when the user opens **Paste As…**, before any option is chosen. Warnings about dropped images or a rejected destination can therefore appear for an option the user does not pick.
````

- [ ] **Step 2: Write `README.md`**

````markdown
# Markdown Clipboard

Paste rich clipboard content as Markdown — only when you ask for it.

Copy from a web page, Word, Google Docs or Notion, then run **Markdown Clipboard: Paste as Markdown** from the Command Palette in a Markdown file. Headings, emphasis, links, lists, task lists, quotes, code, tables and images are converted. A normal paste (Ctrl/Cmd+V) is never changed.

## Images

- Images with a web address stay links: `![alt](https://…)`. Nothing is downloaded.
- Images embedded in the clipboard are saved next to your document, in `assets/` by default, and linked. The same image is saved once.
- Images that cannot be linked or saved (for example Word's temporary files, or any embedded image in an untitled document) are left out, and a warning tells you.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `markdownClipboard.imageDestination` | `assets` | Folder for embedded images, relative to the document's folder. `..` is allowed; empty means the document's own folder; absolute paths are rejected. |

## Keybinding

None by default. To add one, bind `markdownClipboard.pasteAsMarkdown` in Keyboard Shortcuts, for example to `Ctrl+Alt+V` with `when: editorLangId == markdown`.

The command also appears in VS Code's **Paste As…** list.

## Development

```bash
pnpm install
pnpm test:unit      # fast loop
pnpm format && pnpm lint && pnpm typecheck && pnpm test   # gates; e2e opens VS Code and overwrites the clipboard
pnpm package        # build a .vsix
```

Design: [docs/design-specs/extension.md](docs/design-specs/extension.md). Commit messages: [docs/git-convention.md](docs/git-convention.md).
````

- [ ] **Step 3: Flip this plan's status**

When the owner approves this plan its status becomes `accepted`. Now change `Status: accepted (…)` at the top of this file to `Status: implemented (<today's date>)`.

- [ ] **Step 4: Final review checkpoint**

A code review and a security review of the whole branch, with the owner weighing the findings. Additional surface since Task 6: the PowerShell helper runs with `-ExecutionPolicy Bypass` — test-only, never packaged (check `.vscodeignore` with `pnpm package` and `pnpm exec vsce ls --no-dependencies`).

- [ ] **Step 5: Run the gates and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add README.md docs/design-specs/extension.md docs/plans/260920-paste-as-markdown-plan.md
git commit -m "docs: add readme and extension design spec"
```

---

## Acceptance criteria coverage

| Criterion | Task(s) |
| --- | --- |
| AC1 | 5 |
| AC2 | 5, 6 (guard) |
| AC3 | 4 (golden `constructs`, `no-equivalent`, `nested-table`, `headerless-table`; tight and loose lists) |
| AC4 | 1 (purity lint), 4, 5 |
| AC5 | 3, 4, 5, 6 |
| AC6 | 2, 5, 6 |
| AC7 | 4, 5, 6 |
| AC8 | 5, 6 |
| AC9 | 5 (b), 6 (a, b) |
| AC10 | 1 (a), 5 (b), 6 |
| AC11 | 5, 6 |
| AC12 | 2, 4 |
| AC13 | 4 (golden `google-docs`, `google-docs-list`, `word`, `word-list`, `notion`, and the owner's real captures) |
| AC14 | 7 |
