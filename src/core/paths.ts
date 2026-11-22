import os from 'node:os';
import path from 'node:path';

export type Product = 'code' | 'insiders' | 'vscodium' | 'cursor';

export const PRODUCTS: readonly Product[] = ['code', 'insiders', 'vscodium', 'cursor'];

const PRODUCT_DIR: Record<Product, string> = {
  code: 'Code',
  insiders: 'Code - Insiders',
  vscodium: 'VSCodium',
  cursor: 'Cursor',
};

export function isProduct(value: string): value is Product {
  return (PRODUCTS as readonly string[]).includes(value);
}

export interface PathEnv {
  platform: NodeJS.Platform;
  /** Home folder (`os.homedir()` by default). */
  homedir: string;
  env: Record<string, string | undefined>;
}

export function currentPathEnv(): PathEnv {
  return { platform: process.platform, homedir: os.homedir(), env: process.env };
}

/** Default user data folder of a product (the folder that contains `User/` and `code.lock`). */
export function defaultUserDataDir(product: Product, pe: PathEnv = currentPathEnv()): string {
  const name = PRODUCT_DIR[product];
  if (pe.platform === 'darwin') {
    return path.posix.join(pe.homedir, 'Library', 'Application Support', name);
  }
  if (pe.platform === 'win32') {
    const appData = pe.env.APPDATA ?? path.win32.join(pe.homedir, 'AppData', 'Roaming');
    return path.win32.join(appData, name);
  }
  const xdg = pe.env.XDG_CONFIG_HOME ?? path.posix.join(pe.homedir, '.config');
  return path.posix.join(xdg, name);
}

export interface ResolveOptions {
  userDataDir?: string | undefined;
  product?: Product | undefined;
}

/** Priority: explicit option > CHAT_RELINK_USER_DATA_DIR > per-product default. */
export function resolveUserDataDir(opts: ResolveOptions = {}, pe: PathEnv = currentPathEnv()): string {
  if (opts.userDataDir) return path.resolve(opts.userDataDir);
  const fromEnv = pe.env.CHAT_RELINK_USER_DATA_DIR;
  if (fromEnv) return path.resolve(fromEnv);
  return defaultUserDataDir(opts.product ?? 'code', pe);
}

export function workspaceStorageDir(userDataDir: string): string {
  return path.join(userDataDir, 'User', 'workspaceStorage');
}

export function lockFilePath(userDataDir: string): string {
  return path.join(userDataDir, 'code.lock');
}

function userDataFromMarker(fsPath: string, marker: string): string | undefined {
  const parts = path.resolve(fsPath).split(path.sep);
  const i = parts.lastIndexOf(marker);
  if (i < 2 || parts[i - 1] !== 'User') return undefined;
  return parts.slice(0, i - 1).join(path.sep) || path.sep;
}

/**
 * Derive the user data folder from an extension's `storageUri` fsPath:
 * `<userData>/User/workspaceStorage/<id>/<publisher.name>` -> `<userData>`.
 */
export function userDataFromStorageUri(storageFsPath: string): string | undefined {
  return userDataFromMarker(storageFsPath, 'workspaceStorage');
}

/** `<userData>/User/globalStorage/<publisher.name>` -> `<userData>`. */
export function userDataFromGlobalStorageUri(globalFsPath: string): string | undefined {
  return userDataFromMarker(globalFsPath, 'globalStorage');
}

/** Where chat-relink keeps its own journals, backups and plans. */
export function toolHomeDir(pe: PathEnv = currentPathEnv()): string {
  const override = pe.env.CHAT_RELINK_HOME;
  if (override) return path.resolve(override);
  // join with the separator of the injected platform, not the host's
  return (pe.platform === 'win32' ? path.win32 : path.posix).join(pe.homedir, '.chat-relink');
}
