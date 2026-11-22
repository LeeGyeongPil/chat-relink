import { createHash } from 'node:crypto';
import fs from 'node:fs';

export interface FolderStat {
  /** `fs.Stats.birthtimeMs` */
  birthtimeMs: number;
  /** `fs.Stats.ino` */
  ino: number;
}

/**
 * The salt VS Code mixes into the folder hash (see `getWorkspaceIdentifier` in
 * Code - OSS `platform/workspaces/node/workspaces.ts`).
 * macOS: birthtime in ms, Windows: floor(birthtimeMs), Linux: inode.
 * Returns '' when the value is falsy (nothing is appended then).
 */
export function folderSalt(platform: NodeJS.Platform, stat: FolderStat): string {
  let value: number | undefined;
  if (platform === 'linux') value = stat.ino;
  else if (platform === 'darwin') value = Math.trunc(stat.birthtimeMs);
  else if (platform === 'win32') value = Math.floor(stat.birthtimeMs);
  return value ? String(value) : '';
}

/** Workspace storage id of a local folder: md5(fsPath + salt). */
export function computeFolderId(fsPath: string, platform: NodeJS.Platform, stat: FolderStat): string {
  return createHash('md5').update(fsPath).update(folderSalt(platform, stat)).digest('hex');
}

/** What the id of a local folder depends on besides its path. Tests pass fixed values. */
export interface IdInputs {
  /** Defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** Defaults to the real `fs.statSync`. */
  stat?: (fsPath: string) => FolderStat;
}

/**
 * Id of a folder on this machine. Only the defaults touch the real system;
 * every caller in tests injects `platform` and `stat`.
 */
export function localFolderId(fsPath: string, inputs: IdInputs = {}): string {
  const platform = inputs.platform ?? process.platform;
  const stat = inputs.stat ?? ((p: string): FolderStat => fs.statSync(p));
  return computeFolderId(fsPath, platform, stat(fsPath));
}

/** Remote folders (vscode-remote://...) hash the URI string only. */
export function computeRemoteId(uri: string): string {
  return createHash('md5').update(uri).digest('hex');
}
