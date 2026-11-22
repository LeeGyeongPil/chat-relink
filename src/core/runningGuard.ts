import fs from 'node:fs';
import { lockFilePath } from './paths';
import { openDb, readIndex, writeIndex, type ChatIndex } from './stateDb';

export type RunningState = 'running' | 'stale' | 'none';

export interface RunningCheck {
  state: RunningState;
  pid?: number;
  lockFile: string;
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists but belongs to someone else.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * VS Code writes its PID to `<userData>/code.lock` and removes it only on a clean quit.
 * A live PID means "running"; a dead PID is a leftover ("stale") and only warrants a warning.
 * SQLite locks cannot be used for this: VS Code holds no lock between statements.
 */
export function checkRunning(userDataDir: string, alive: (pid: number) => boolean = isPidAlive): RunningCheck {
  const lockFile = lockFilePath(userDataDir);
  let text: string;
  try {
    text = fs.readFileSync(lockFile, 'utf8').trim();
  } catch {
    return { state: 'none', lockFile };
  }
  const pid = Number.parseInt(text, 10);
  if (!Number.isInteger(pid) || pid <= 0) return { state: 'stale', lockFile };
  return { state: alive(pid) ? 'running' : 'stale', pid, lockFile };
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

