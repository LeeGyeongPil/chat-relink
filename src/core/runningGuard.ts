import fs from 'node:fs';
import { lockFilePath } from './paths';
import { openDb, readIndex, writeIndex, type ChatIndex } from './stateDb';

export type RunningState = 'running' | 'stale' | 'none';

export interface RunningCheck {
  state: RunningState;
  pid?: number;
  lockFile: string;
}

/** `process.kill(pid, 0)`: sends no signal, only asks "does this PID exist?". */
export type KillProbe = (pid: number, signal: 0) => void;

const realKill: KillProbe = (pid, signal) => {
  process.kill(pid, signal);
};

/**
 * Is a process with this PID alive? The probe is injectable so tests never depend on
 * which PIDs exist on the machine that runs them.
 */
export function isPidAlive(pid: number, kill: KillProbe = realKill): boolean {
  try {
    kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists but belongs to someone else. ESRCH (or anything else): gone.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Reads `code.lock`; `undefined` when there is no lock file. */
export function readLockFile(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

/** Everything the running check asks the system. Defaults are the real calls. */
export interface GuardDeps {
  readLock?: (file: string) => string | undefined;
  isAlive?: (pid: number) => boolean;
}

/**
 * VS Code writes its PID to `<userData>/code.lock` and removes it only on a clean quit.
 * A live PID means "running"; a dead PID is a leftover ("stale") and only warrants a warning.
 * SQLite locks cannot be used for this: VS Code holds no lock between statements.
 */
export function checkRunning(userDataDir: string, deps: GuardDeps = {}): RunningCheck {
  const lockFile = lockFilePath(userDataDir);
  const text = (deps.readLock ?? readLockFile)(lockFile);
  if (text === undefined) return { state: 'none', lockFile };
  const pid = Number.parseInt(text.trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) return { state: 'stale', lockFile };
  const alive = (deps.isAlive ?? isPidAlive)(pid);
  return { state: alive ? 'running' : 'stale', pid, lockFile };
}

export interface RaceResult {
  externalVisibleBeforeFlush: boolean;
  externalLostAfterFlush: boolean;
  finalKeys: string[];
}

/**
 * Reproduce what a running VS Code does to an external index edit (research probe 5):
 * it reads the index once and keeps it in memory, and on the next chat save it writes
 * the whole cached index back. Operates on a throwaway copy of a state DB only.
 */
export function simulateRunningFlush(dbFile: string): RaceResult {
  const vscode = openDb(dbFile);
  const cache: ChatIndex = readIndex(vscode); // cached when the window opened
  const tool = openDb(dbFile);
  const edited = readIndex(tool);
  edited.entries['external-entry'] = { sessionId: 'external-entry', title: 'added by an external tool', lastMessageDate: 1 };
  writeIndex(tool, edited); // the write succeeds: nothing blocks it
  tool.close();

  const peek = openDb(dbFile, { readOnly: true });
  const visible = 'external-entry' in readIndex(peek).entries;
  peek.close();

  cache.entries['vscode-new-chat'] = { sessionId: 'vscode-new-chat', title: 'a new chat', lastMessageDate: 2 };
  writeIndex(vscode, cache); // flush of the whole cache
  vscode.close();

  const after = openDb(dbFile, { readOnly: true });
  const finalKeys = Object.keys(readIndex(after).entries);
  after.close();
  return {
    externalVisibleBeforeFlush: visible,
    externalLostAfterFlush: !finalKeys.includes('external-entry'),
    finalKeys,
  };
}
