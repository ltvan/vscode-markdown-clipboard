export function isAbsoluteDestination(destination: string): boolean {
  return /^([\\/]|[A-Za-z]:)/.test(destination.trim());
}

export type DestinationFailure =
  'absolute' | 'unknown-variable' | 'misplaced-variable' | 'no-workspace';

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
  let rest = template.trim().replaceAll('${documentBaseName}', document.baseName);
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

  const target = collapse(destinationSegments(rest));
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
