import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeLock } from '../src/core/fixture';
import { applyRelink, EXIT, hashTree, planRelink, RelinkError } from '../src/core/relink';
import { checkRunning, simulateRunningFlush } from '../src/core/runningGuard';
import { findSlotByPath, scanStorage } from '../src/core/scan';
import { makeFixture } from './helpers';

function setup() {
  const fx = makeFixture();
  const slots = scanStorage(fx.storageDir);
  const from = slots.find((s) => s.id === fx.oldId)!;
  const to = findSlotByPath(slots, fx.currentFolder)!;
  return { fx, plan: planRelink({ from, to }), to };
}

/** A PID that is certainly not alive: above Linux's largest pid_max (2^22) and macOS's 99999. */
const DEAD_PID = 2147483646;

describe('running VS Code protection (AC-5)', () => {
  it('blocks --apply with exit code 3 and writes nothing when the lock holds a live PID', () => {
    const { fx, plan } = setup();
    writeLock(fx.userDataDir, process.pid);
    const before = hashTree(fx.root);
    try {
      applyRelink(plan, { userDataDir: fx.userDataDir, toolHome: fx.toolHome });
      expect.unreachable();
    } catch (e) {
      expect((e as RelinkError).code).toBe(EXIT.running);
      expect((e as Error).message).toMatch(/VS Code is running/);
    }
    expect(hashTree(fx.root)).toBe(before);
    expect(fs.existsSync(fx.toolHome)).toBe(false);
  });

  it('warns and continues when the lock is a leftover from a dead PID', () => {
    const { fx, plan } = setup();
    writeLock(fx.userDataDir, DEAD_PID);
    const result = applyRelink(plan, {
      userDataDir: fx.userDataDir,
      toolHome: fx.toolHome,
      checkRunning: (dir) => checkRunning(dir, () => false),
    });
    expect(result.copied).toHaveLength(2);
    expect(result.warnings.join(' ')).toMatch(/leftover/);
  });

  it('classifies none, running, stale and garbage lock files', () => {
    const { fx } = setup();
    expect(checkRunning(fx.userDataDir).state).toBe('none');
    writeLock(fx.userDataDir, process.pid);
    expect(checkRunning(fx.userDataDir)).toMatchObject({ state: 'running', pid: process.pid });
    expect(checkRunning(fx.userDataDir, () => false).state).toBe('stale');
    fs.writeFileSync(path.join(fx.userDataDir, 'code.lock'), 'not a pid');
    expect(checkRunning(fx.userDataDir).state).toBe('stale');
  });

  it('race simulation: an external index edit is wiped when the running app flushes its cache', () => {
    const { to } = setup();
    const result = simulateRunningFlush(path.join(to.dir, 'state.vscdb'));
    expect(result.externalVisibleBeforeFlush).toBe(true); // SQLite does not stop the write ...
    expect(result.externalLostAfterFlush).toBe(true); // ... but the next flush erases it
    expect(result.finalKeys).toEqual(['vscode-new-chat']);
  });
});
