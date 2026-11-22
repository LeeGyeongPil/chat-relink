import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli/index';
import { writeLock } from '../src/core/fixture';
import { applyRelink, EXIT, hashTree, planRelink, RelinkError } from '../src/core/relink';
import { checkRunning, isPidAlive, simulateRunningFlush, type GuardDeps, type KillProbe } from '../src/core/runningGuard';
import { findSlotByPath, scanStorage } from '../src/core/scan';
import { makeFixture } from './helpers';

// No real PID is ever probed here: the lock content and the liveness answer are injected,
// so the result is the same on any machine (CI runner, container, laptop).
const FAKE_PID = 4242;
const lockHolds = (pid: number, alive: boolean): GuardDeps => ({ readLock: () => String(pid), isAlive: () => alive });
const noLock: GuardDeps = { readLock: () => undefined, isAlive: () => expect.unreachable('no PID to check') };

function setup() {
  const fx = makeFixture();
  const slots = scanStorage(fx.storageDir, 'linux');
  const from = slots.find((s) => s.id === fx.oldId)!;
  const to = findSlotByPath(slots, fx.currentFolder)!;
  return { fx, plan: planRelink({ from, to }), to };
}

async function cli(args: string[], env: Record<string, string | undefined>, guard: GuardDeps) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(args, { out: (s) => out.push(s), err: (s) => err.push(s) }, env, { guard });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('running VS Code protection (AC-5)', () => {
  it('blocks --apply with exit code 3 and writes nothing when the lock holds a live PID', () => {
    const { fx, plan } = setup();
    const before = hashTree(fx.root);
    try {
      applyRelink(plan, { userDataDir: fx.userDataDir, toolHome: fx.toolHome, checkRunning: (d) => checkRunning(d, lockHolds(FAKE_PID, true)) });
      expect.unreachable();
    } catch (e) {
      expect((e as RelinkError).code).toBe(EXIT.running);
      expect((e as Error).message).toMatch(/VS Code is running/);
    }
    expect(hashTree(fx.root)).toBe(before);
    expect(fs.existsSync(fx.toolHome)).toBe(false);
  });

  it('CLI relink --apply: exit 3, nothing written, English or Korean message', async () => {
    const { fx } = setup();
    const args = ['relink', '--from', fx.oldId.slice(0, 8), '--to', fx.currentFolder, '--apply', '--user-data-dir', fx.userDataDir];
    const before = hashTree(fx.root);
    const en = await cli(args, { CHAT_RELINK_HOME: fx.toolHome, CHAT_RELINK_LANG: 'en' }, lockHolds(FAKE_PID, true));
    expect(en.code).toBe(3);
    expect(en.err).toMatch(/VS Code is running/);
    expect(en.err).toContain(String(FAKE_PID));
    const ko = await cli([...args, '--lang', 'ko'], { CHAT_RELINK_HOME: fx.toolHome }, lockHolds(FAKE_PID, true));
    expect(ko.code).toBe(3);
    expect(ko.err).toContain('VS Code 가 실행 중입니다');
    expect(ko.err).not.toMatch(/is running/);
    expect(hashTree(fx.root)).toBe(before);
    expect(fs.existsSync(fx.toolHome)).toBe(false);
  });

  it('warns and continues when the lock is a leftover from a dead PID', async () => {
    const { fx } = setup();
    const r = await cli(
      ['relink', '--from', fx.oldId.slice(0, 8), '--to', fx.currentFolder, '--apply', '--user-data-dir', fx.userDataDir],
      { CHAT_RELINK_HOME: fx.toolHome, CHAT_RELINK_LANG: 'en' },
      lockHolds(FAKE_PID, false),
    );
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/leftover/);
    expect(r.out).toContain('Relinked 2 session(s).');
  });

  it('proceeds without a warning when there is no lock file', async () => {
    const { fx } = setup();
    const r = await cli(
      ['relink', '--from', fx.oldId.slice(0, 8), '--to', fx.currentFolder, '--apply', '--user-data-dir', fx.userDataDir],
      { CHAT_RELINK_HOME: fx.toolHome, CHAT_RELINK_LANG: 'en' },
      noLock,
    );
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/leftover/);
    expect(r.out).toContain('Relinked 2 session(s).');
  });

  it('classifies none, running, stale and garbage lock contents', () => {
    const dir = '/fixture/userdata';
    expect(checkRunning(dir, noLock)).toEqual({ state: 'none', lockFile: path.join(dir, 'code.lock') });
    expect(checkRunning(dir, lockHolds(FAKE_PID, true))).toMatchObject({ state: 'running', pid: FAKE_PID });
    expect(checkRunning(dir, lockHolds(FAKE_PID, false))).toMatchObject({ state: 'stale', pid: FAKE_PID });
    expect(checkRunning(dir, { readLock: () => 'not a pid', isAlive: () => true }).state).toBe('stale');
    expect(checkRunning(dir, { readLock: () => ' 17\n', isAlive: (pid) => pid === 17 }).state).toBe('running');
  });

  it('the default lock reader reads <userData>/code.lock (liveness still injected)', () => {
    const { fx } = setup();
    expect(checkRunning(fx.userDataDir, { isAlive: () => true }).state).toBe('none');
    writeLock(fx.userDataDir, FAKE_PID);
    expect(checkRunning(fx.userDataDir, { isAlive: (pid) => pid === FAKE_PID })).toMatchObject({ state: 'running', pid: FAKE_PID });
  });

  it('default isAlive: signal 0 succeeds -> alive, ESRCH -> gone, EPERM -> alive (someone else owns it)', () => {
    const calls: Array<[number, number]> = [];
    const ok: KillProbe = (pid, sig) => {
      calls.push([pid, sig]);
    };
    const failWith =
      (code: string): KillProbe =>
      () => {
        throw Object.assign(new Error(code), { code });
      };
    expect(isPidAlive(FAKE_PID, ok)).toBe(true);
    expect(calls).toEqual([[FAKE_PID, 0]]); // only probes, never sends a real signal
    expect(isPidAlive(FAKE_PID, failWith('ESRCH'))).toBe(false);
    expect(isPidAlive(FAKE_PID, failWith('EPERM'))).toBe(true);
  });

  it('race simulation: an external index edit is wiped when the running app flushes its cache', () => {
    const { to } = setup();
    const result = simulateRunningFlush(path.join(to.dir, 'state.vscdb'));
    expect(result.externalVisibleBeforeFlush).toBe(true); // SQLite does not stop the write ...
    expect(result.externalLostAfterFlush).toBe(true); // ... but the next flush erases it
    expect(result.finalKeys).toEqual(['vscode-new-chat']);
  });
});
