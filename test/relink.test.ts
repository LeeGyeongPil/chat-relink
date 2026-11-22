import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_SESSION_IDS } from '../src/core/fixture';
import { applyRelink, EXIT, hashTree, planRelink, RelinkError, readJournal } from '../src/core/relink';
import { findSlotByPath, scanStorage } from '../src/core/scan';
import { createStateDb, INDEX_ENTRY_LIMIT, integrityCheck, openDb, readIndex, readKey } from '../src/core/stateDb';
import { makeFixture } from './helpers';

function setup() {
  const fx = makeFixture();
  const slots = scanStorage(fx.storageDir);
  const from = slots.find((s) => s.id === fx.oldId)!;
  const to = findSlotByPath(slots, fx.currentFolder)!;
  return { fx, from, to };
}

function indexKeys(dbFile: string): string[] {
  const db = openDb(dbFile, { readOnly: true });
  try {
    return Object.keys(readIndex(db).entries).sort();
  } finally {
    db.close();
  }
}

describe('offline relink (AC-4)', () => {
  it('dry run does not change a single byte of the fixture tree', () => {
    const { fx, from, to } = setup();
    const before = hashTree(fx.root);
    const plan = planRelink({ from, to });
    expect(plan.items.map((i) => i.action)).toEqual(['copy', 'copy']);
    expect(plan.indexCountBefore).toBe(0);
    expect(plan.indexCountAfter).toBe(2);
    expect(hashTree(fx.root)).toBe(before);
    expect(fs.existsSync(fx.toolHome)).toBe(false);
  });

  it('apply: backup, copy, index update, verification, unrelated keys and source kept', () => {
    const { fx, from, to } = setup();
    const srcBefore = hashTree(from.dir);
    const plan = planRelink({ from, to });
    const result = applyRelink(plan, { userDataDir: fx.userDataDir, toolHome: fx.toolHome });

    expect(result.copied.sort()).toEqual([FIXTURE_SESSION_IDS.loginBug, FIXTURE_SESSION_IDS.cartRefactor].sort());
    expect(result.integrity).toBe('ok');
    expect(result.indexCountAfter).toBe(2);
    expect(fs.existsSync(result.backup)).toBe(true);
    expect(readJournal(result.journal).status).toBe('applied');

    const dst = path.join(to.dir, 'state.vscdb');
    expect(indexKeys(dst)).toEqual([FIXTURE_SESSION_IDS.cartRefactor, FIXTURE_SESSION_IDS.loginBug].sort());
    const db = openDb(dst, { readOnly: true });
    expect(integrityCheck(db)).toBe('ok');
    expect(readKey(db, 'workbench.unrelated')).toBe('"keep me"');
    const entry = readIndex(db).entries[FIXTURE_SESSION_IDS.loginBug]!;
    expect(entry.title).toBe('Fix login bug'); // original title and date carried over
    db.close();
    for (const id of result.copied) {
      expect(fs.existsSync(path.join(to.dir, 'chatSessions', `${id}.jsonl`))).toBe(true);
    }
    expect(hashTree(from.dir)).toBe(srcBefore);
  });

  it('never overwrites an existing session file and skips it with a reason', () => {
    const { fx, from, to } = setup();
    const existing = path.join(to.dir, 'chatSessions', `${FIXTURE_SESSION_IDS.loginBug}.jsonl`);
    fs.writeFileSync(existing, 'KEEP');
    const plan = planRelink({ from, to });
    const skip = plan.items.find((i) => i.sessionId === FIXTURE_SESSION_IDS.loginBug)!;
    expect(skip).toMatchObject({ action: 'skip', reason: 'exists' });

    const result = applyRelink(plan, { userDataDir: fx.userDataDir, toolHome: fx.toolHome });
    expect(result.copied).toEqual([FIXTURE_SESSION_IDS.cartRefactor]);
    expect(result.skipped).toEqual([{ sessionId: FIXTURE_SESSION_IDS.loginBug, reason: 'exists' }]);
    expect(fs.readFileSync(existing, 'utf8')).toBe('KEEP');
  });

  it('supports choosing sessions by id prefix and rejects unknown ones', () => {
    const { from, to } = setup();
    const plan = planRelink({ from, to, sessionIds: ['1111'] });
    expect(plan.items.map((i) => i.sessionId)).toEqual([FIXTURE_SESSION_IDS.loginBug]);
    expect(() => planRelink({ from, to, sessionIds: ['zzzz'] })).toThrowError(/No session matches/);
  });

  it('warns when the index would pass the 400 entry limit', () => {
    const { fx, from, to } = setup();
    const entries: Record<string, { sessionId: string }> = {};
    for (let i = 0; i < INDEX_ENTRY_LIMIT - 1; i++) entries[`old-${i}`] = { sessionId: `old-${i}` };
    fs.rmSync(path.join(to.dir, 'state.vscdb'));
    createStateDb(path.join(to.dir, 'state.vscdb'), { version: 1, entries });
    const plan = planRelink({ from, to });
    expect(plan.overLimit).toBe(true);
    expect(plan.warnings[0]).toMatch(/400/);
    void fx;
  });

  it('refuses to write when the index version is not 1', () => {
    const { fx, from, to } = setup();
    fs.rmSync(path.join(to.dir, 'state.vscdb'));
    const db = (() => {
      createStateDb(path.join(to.dir, 'state.vscdb'), { version: 2, entries: {} });
      return 0;
    })();
    void db;
    expect(() => planRelink({ from, to })).toThrowError(/version 2/);
    void fx;
  });

  it('exits with code 5 when the target slot has no state database yet', () => {
    const { from, to } = setup();
    fs.rmSync(path.join(to.dir, 'state.vscdb'));
    try {
      planRelink({ from, to });
      expect.unreachable();
    } catch (e) {
      expect((e as RelinkError).code).toBe(EXIT.noTarget);
      expect((e as Error).message).toMatch(/Open that folder in VS Code once/);
    }
  });

  it('refuses a non-orphan source and identical slots', () => {
    const { from, to } = setup();
    expect(() => planRelink({ from: to, to: from })).toThrowError(/not an orphan/);
    expect(() => planRelink({ from, to: from })).toThrowError(/same slot/);
  });
});
