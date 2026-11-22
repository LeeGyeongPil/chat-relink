import { createHash } from 'node:crypto';

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

/** Remote folders (vscode-remote://...) hash the URI string only. */
export function computeRemoteId(uri: string): string {
  return createHash('md5').update(uri).digest('hex');
}
