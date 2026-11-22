import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyRelink, EXIT, hashTree, planRelink, readJournal, undoRelink, VerifyError } from '../src/core/relink';
import { findSlotByPath, scanStorage } from '../src/core/scan';
import { openDb, readIndex, writeIndex } from '../src/core/stateDb';
import { writeLock } from '../src/core/fixture';
import { makeFixture } from './helpers';

function setup() {
  const fx = makeFixture();
  const slots = scanStorage(fx.storageDir);
  const from = slots.find((s) => s.id === fx.oldId)!;
  const to = findSlotByPath(slots, fx.currentFolder)!;
  const snapshot = () => {
    const db = openDb(path.join(to.dir, 'state.vscdb'), { readOnly: true });
    const keys = Object.keys(readIndex(db).entries).sort();
    db.close();
    return { keys, files: fs.readdirSync(path.join(to.dir, 'chatSessions')).sort() };
  };
  return { fx, from, to, snapshot };
}

describe('undo and automatic rollback (AC-6)', () => {
  it('undo restores the index and the file list to the state before apply', () => {
    const { fx, from, to, snapshot } = setup();
    const before = snapshot();
    const result = applyRelink(planRelink({ from, to }), { userDataDir: fx.userDataDir, toolHome: fx.toolHome });
    expect(snapshot()).not.toEqual(before);

    const undo = undoRelink(result.journal);
    expect(undo).toMatchObject({ mode: 'restored-backup', removedFiles: 2, confirmed: true });
    expect(snapshot()).toEqual(before);
    expect(readJournal(result.journal).status).toBe('undone');
    expect(() => undoRelink(result.journal)).toThrowError(/already undone/);
  });

  it('undo keeps newer chats: if the database changed since apply only the added entries go', () => {
    const { fx, from, to } = setup();
    const result = applyRelink(planRelink({ from, to }), { userDataDir: fx.userDataDir, toolHome: fx.toolHome });
    // VS Code ran later and saved a new chat
    const db = openDb(path.join(to.dir, 'state.vscdb'));
    const index = readIndex(db);
    index.entries['newer-chat'] = { sessionId: 'newer-chat', title: 'newer' };
    writeIndex(db, index);
    db.close();

    const undo = undoRelink(result.journal);
    expect(undo.mode).toBe('removed-entries');
    const check = openDb(path.join(to.dir, 'state.vscdb'), { readOnly: true });
    expect(Object.keys(readIndex(check).entries)).toEqual(['newer-chat']);
    check.close();
  });

  it('undo is refused while VS Code is running', () => {
    const { fx, from, to } = setup();
    const result = applyRelink(planRelink({ from, to }), { userDataDir: fx.userDataDir, toolHome: fx.toolHome });
    writeLock(fx.userDataDir, process.pid);
    try {
      undoRelink(result.journal);
      expect.unreachable();
    } catch (e) {
      expect((e as { code: number }).code).toBe(EXIT.running);
    }
  });

  it('an injected verification fault rolls everything back and reports exit code 4', () => {
    const { fx, from, to, snapshot } = setup();
    const before = snapshot();
    const treeBefore = hashTree(to.dir);
    try {
      applyRelink(planRelink({ from, to }), { userDataDir: fx.userDataDir, toolHome: fx.toolHome, injectVerifyFault: true });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(VerifyError);
      expect((e as VerifyError).code).toBe(EXIT.verify);
      expect((e as VerifyError).failures).toContain('injected verification fault');
      expect(readJournal((e as VerifyError).journal).status).toBe('rolled-back');
    }
    expect(snapshot()).toEqual(before);
    // sorted: ext4 (CI) lists names in hash order, APFS sorted
    expect(fs.readdirSync(path.join(to.dir, 'chatSessions')).sort()).toEqual(before.files);
    void treeBefore;
  });

  it('a damaged journal gives a clear error', () => {
    const { fx } = setup();
    const file = path.join(fx.root, 'bad.json');
    fs.writeFileSync(file, '{"nope":true}');
    expect(() => undoRelink(file)).toThrowError(/damaged/);
    expect(() => undoRelink(path.join(fx.root, 'missing.json'))).toThrowError(/missing or damaged/);
  });
});
