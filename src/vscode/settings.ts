import * as vscode from 'vscode';
import { type DestinationFailure, type DocumentLocation, resolveDestination } from '../core/paths';

export const DEFAULT_IMAGE_DESTINATION = 'assets';

export interface Settings {
  /** Already resolved: a path relative to the document's folder. */
  imageDestination: string;
  rejected?: { configured: string; reason: DestinationFailure };
}

function locate(document: vscode.TextDocument): DocumentLocation {
  const path = document.uri.path;
  const fileName = path.slice(path.lastIndexOf('/') + 1);
  const dot = fileName.lastIndexOf('.');
  const baseName = dot > 0 ? fileName.slice(0, dot) : fileName;
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!folder) return { baseName, workspaceRelativeDir: undefined };
  const relative = path.slice(folder.uri.path.replace(/\/$/, '').length);
  return { baseName, workspaceRelativeDir: relative.split('/').filter(Boolean).slice(0, -1) };
}

export function readSettings(document: vscode.TextDocument): Settings {
  const configured = vscode.workspace
    .getConfiguration('markdownClipboard', document.uri)
    .get<string>('imageDestination', DEFAULT_IMAGE_DESTINATION);
  const resolved = resolveDestination(configured, locate(document));
  if (resolved.ok) return { imageDestination: resolved.path };
  return {
    imageDestination: DEFAULT_IMAGE_DESTINATION,
    rejected: { configured, reason: resolved.reason },
  };
}
