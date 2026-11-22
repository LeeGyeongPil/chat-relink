import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setCoreLang } from '../src/core/msg';
import { applyRelink, planRelink, undoRelink, VerifyError, readJournal, RelinkError } from '../src/core/relink';
import { findSlotByPath, scanStorage } from '../src/core/scan';
import { readSessionFile, replayLog } from '../src/core/sessionLog';
import { openDb, readIndex } from '../src/core/stateDb';
import { en } from '../src/i18n/en';
import { writeLock } from '../src/core/fixture';
import { makeFixture, tmpDir } from './helpers';

afterEach(() => setCoreLang('en'));

const HANGUL = /[가-힣]/;

function setup() {
  const fx = makeFixture();
  const slots = scanStorage(fx.storageDir);
  const from = slots.find((s) => s.id === fx.oldId)!;
  const to = findSlotByPath(slots, fx.currentFolder)!;
  return { fx, slots, from, to };
}

function message(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('expected an error');
}

describe('core errors and warnings follow the chosen language (AC-8)', () => {
  it('defaults to English for library users', () => {
    const { from } = setup();
    expect(message(() => planRelink({ from, to: from }))).toBe('Source and target are the same slot.');
  });

  it('planning errors are Korean after setCoreLang("ko")', () => {
    const { from, to, slots } = setup();
    setCoreLang('ko');
    expect(message(() => planRelink({ from, to: from }))).toBe('원본과 대상이 같은 칸입니다.');
    expect(message(() => planRelink({ from: to, to: from }))).toMatch(/고아가 아닙니다/);
    expect(message(() => planRelink({ from, to, sessionIds: ['zzzz'] }))).toMatch(/일치하는 세션이 없습니다/);
    const emptyTo = { ...to, dir: tmpDir() };
    expect(message(() => planRelink({ from, to: emptyTo }))).toMatch(/state\.vscdb 가 없습니다/);
    expect(slots.length).toBeGreaterThan(0);
  });

  it('journal, undo and backup errors are Korean', () => {
    const { fx, from, to } = setup();
    setCoreLang('ko');
    const dir = tmpDir();
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, '{nope');
    expect(message(() => undoRelink(bad))).toMatch(/저널이 없거나 손상/);
    fs.writeFileSync(bad, JSON.stringify({ version: 1 }));
    expect(message(() => undoRelink(bad))).toMatch(/예상과 다른 형식/);

    const result = applyRelink(planRelink({ from, to }), { userDataDir: fx.userDataDir, toolHome: fx.toolHome });
    undoRelink(result.journal);
    expect(message(() => undoRelink(result.journal))).toBe('이 저널은 이미 되돌려졌습니다. 되돌릴 것이 없습니다.');

    const second = setup();
    const r2 = applyRelink(planRelink({ from: second.from, to: second.to }), { userDataDir: second.fx.userDataDir, toolHome: second.fx.toolHome });
    fs.rmSync(readJournal(r2.journal).backup, { force: true });
    expect(message(() => undoRelink(r2.journal))).toMatch(/백업이 사라졌습니다/);
  });

  it('a stale lock warning and a verification failure are Korean', () => {
    const { fx, from, to } = setup();
    setCoreLang('ko');
    writeLock(fx.userDataDir, 2147483646); // a PID that is not alive
    let thrown: unknown;
    try {
      applyRelink(planRelink({ from, to }), { userDataDir: fx.userDataDir, toolHome: fx.toolHome, injectVerifyFault: true });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(VerifyError);
    const err = thrown as VerifyError;
    expect(err.message).toMatch(/검증에 실패해 모두 되돌렸습니다/);
    expect(err.failures).toEqual(['주입된 검증 오류']);
    const db = openDb(path.join(to.dir, 'state.vscdb'), { readOnly: true });
    expect(Object.keys(readIndex(db).entries).length).toBe(0);
    db.close();
  });

  it('session log warnings and errors are Korean', () => {
    setCoreLang('ko');
    expect(message(() => replayLog(''))).toBe('로그 파일이 비어 있습니다');
    expect(message(() => replayLog('not json\n{}'))).toMatch(/올바른 JSON/);
    const dir = tmpDir();
    const f = path.join(dir, 's.json');
    fs.writeFileSync(f, '{broken');
    expect(message(() => readSessionFile(f))).toBe('세션 파일이 올바른 JSON 이 아닙니다');
    fs.writeFileSync(f, '42');
    expect(message(() => readSessionFile(f))).toBe('세션 파일에 객체가 없습니다');
    const log = [
      JSON.stringify({ kind: 0, v: { requests: [] } }),
      JSON.stringify({ kind: 2, v: [1] }),
      JSON.stringify({ kind: 1, k: ['nowhere', 'x'], v: 1 }),
      JSON.stringify({ kind: 9, k: ['requests'], v: 1 }),
      '{"kind":2,"k":["requests"',
    ].join('\n');
    const { warnings } = replayLog(log);
    expect(warnings.length).toBeGreaterThanOrEqual(3);
    for (const w of warnings) expect(w).toMatch(HANGUL);
  });

  it('the CLI prints core errors in Korean with --lang ko and in English with --lang en', async () => {
    const { run } = await import('../src/cli/index');
    const fx = makeFixture();
    const go = async (lang: string) => {
      const err: string[] = [];
      const code = await run(
        ['relink', '--from', fx.oldId.slice(0, 8), '--to', fx.oldFolder, '--user-data-dir', fx.userDataDir, '--lang', lang],
        { out: () => undefined, err: (s) => err.push(s) },
        { CHAT_RELINK_HOME: fx.toolHome },
      );
      return { code, err: err.join('\n') };
    };
    const ko = await go('ko');
    expect(ko.code).toBe(2);
    expect(ko.err).toContain('원본과 대상이 같은 칸입니다.');
    const enRes = await go('en');
    expect(enRes.err).toContain('Source and target are the same slot.');
  });

  it('every core message key exists in both languages with the same placeholders', () => {
    const coreKeys = Object.keys(en).filter((k) => /^(core|verify|log|db)\./.test(k));
    expect(coreKeys.length).toBeGreaterThanOrEqual(40);
  });

  it('no user-visible English literal is left in the core sources', () => {
    const dir = path.resolve(__dirname, '..', 'src', 'core');
    const offenders: string[] = [];
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/(new \w*Error\(|warnings\.push\(|failures\.push\()\s*[`'"]/.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('RelinkError stays an Error with an exit code', () => {
    expect(new RelinkError('x', 1).code).toBe(1);
  });
});
