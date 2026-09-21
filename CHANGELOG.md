# Change log

## 0.1.0 — 2026-09-21

First release.

- **Paste as Markdown** command (`Markdown Clipboard: Paste as Markdown`, also listed under **Paste As…**): converts rich text copied from web pages, Word, Google Docs, Notion or VS Code's Markdown preview into Markdown. A normal paste is never changed.
- Headings, emphasis, links, nested and task lists, quotes, code, tables and line breaks are converted; Word's list paragraphs and Google Docs' list markup become real lists.
- Images: web images stay links; images embedded in the clipboard are saved next to the document (`assets/` by default, configurable with `markdownClipboard.imageDestination`, which supports `${workspaceFolder}`, `${documentDirName}` and `${documentBaseName}`) and linked relative to the document. Images that cannot be linked or saved are left out, and a warning says how many and why.
- Safety: clipboard content is treated as untrusted — file names come from a content hash, only SVG that passes a strict safety check is saved, links with `javascript:`, `vbscript:` or `data:` targets keep their text and lose the link, and in an untrusted workspace the workspace's image destination is ignored.
- Conversion runs in the background, so large pastes do not freeze VS Code and can be cancelled.
