export function isAbsoluteDestination(destination: string): boolean {
  return /^([\\/]|[A-Za-z]:)/.test(destination.trim());
}

export type DestinationFailure =
  'absolute' | 'unknown-variable' | 'misplaced-variable' | 'no-workspace' | 'invalid-character';

export interface DocumentLocation {
  /** File name without extension. */
  baseName: string;
  /** Segments of the document's folder relative to its workspace folder; undefined when it is in none. */
  workspaceRelativeDir: string[] | undefined;
}

export type ResolvedDestination =
  { ok: true; path: string } | { ok: false; reason: DestinationFailure };

const WORKSPACE_FOLDER = '${workspaceFolder}';
const DOCUMENT_DIR = '${documentDirName}';
const DOCUMENT_BASE_NAME = '${documentBaseName}';
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
/** Stands in for the document's base name while the template is checked. A template
 * holding a control character is rejected, so this can never clash with its text. */
const BASE_NAME_MARK = '\u0001';

/** The base name is data, not template: it may name one segment and nothing more. */
function segmentOf(baseName: string): string {
  const segment = baseName.replace(/[/\\\u0000-\u001f\u007f]/g, '');
  return segment === '' || segment === '.' || segment === '..' ? '_' : segment;
}

function collapse(segments: string[]): string[] {
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === '..' && out.length > 0 && out.at(-1) !== '..') out.pop();
    else out.push(segment);
  }
  return out;
}

/** Expands the destination's variables into a path relative to the document's folder. */
export function resolveDestination(
  template: string,
  document: DocumentLocation,
): ResolvedDestination {
  const trimmed = template.trim();
  if (CONTROL_CHARACTER.test(trimmed)) return { ok: false, reason: 'invalid-character' };
  // the checks below run on the template alone: the base name must not decide its shape
  let rest = trimmed.replaceAll(DOCUMENT_BASE_NAME, BASE_NAME_MARK);
  let fromWorkspace = false;
  if (rest.startsWith(WORKSPACE_FOLDER)) {
    fromWorkspace = true;
    rest = rest.slice(WORKSPACE_FOLDER.length);
  } else if (rest.startsWith(DOCUMENT_DIR)) {
    rest = rest.slice(DOCUMENT_DIR.length);
  } else if (isAbsoluteDestination(rest)) {
    return { ok: false, reason: 'absolute' };
  }
  if (rest.includes(WORKSPACE_FOLDER) || rest.includes(DOCUMENT_DIR)) {
    return { ok: false, reason: 'misplaced-variable' };
  }
  if (/\$\{[^}]*\}/.test(rest)) return { ok: false, reason: 'unknown-variable' };

  const baseName = segmentOf(document.baseName);
  const target = collapse(
    destinationSegments(rest).map((segment) => segment.replaceAll(BASE_NAME_MARK, baseName)),
  );
  if (!fromWorkspace) return { ok: true, path: target.join('/') };

  const from = document.workspaceRelativeDir;
  if (!from) return { ok: false, reason: 'no-workspace' };
  let common = 0;
  while (common < from.length && common < target.length && from[common] === target[common]) {
    common++;
  }
  const ups = Array<string>(from.length - common).fill('..');
  return { ok: true, path: [...ups, ...target.slice(common)].join('/') };
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
