import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli/index';
import { en } from '../src/i18n/en';
import { ko } from '../src/i18n/ko';
import { langFromLocale, resolveLang, t } from '../src/i18n/messages';
import { makeFixture } from './helpers';

async function cli(args: string[], env: Record<string, string | undefined> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(args, { out: (s) => out.push(s), err: (s) => err.push(s) }, env);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('two languages (AC-8)', () => {
  it('en and ko define exactly the same message keys', () => {
    expect(Object.keys(ko).sort()).toEqual(Object.keys(en).sort());
    for (const [key, text] of Object.entries(ko)) {
      // placeholders must match so no value is lost in translation
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(ph(text), key).toEqual(ph((en as Record<string, string>)[key]!));
    }
  });

  it('package.nls.json and package.nls.ko.json have the same keys', () => {
    const root = path.resolve(__dirname, '..');
    const a = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.json'), 'utf8'));
    const b = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.ko.json'), 'utf8'));
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
    // every %key% used in package.json exists in the table
    const pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
    for (const m of pkg.matchAll(/"%([\w.]+)%"/g)) expect(a).toHaveProperty(m[1]!);
  });

  it('--help and scan come out in the chosen language', async () => {
    const fx = makeFixture();
    const base = ['--user-data-dir', fx.userDataDir, '--current', fx.currentFolder];
    const enHelp = await cli(['--help', '--lang', 'en']);
    const koHelp = await cli(['--help', '--lang', 'ko']);
    expect(enHelp.out).toContain('Usage:');
    expect(koHelp.out).toContain('사용법:');
    expect(enHelp.out).not.toContain('사용법:');

    const enScan = await cli(['scan', ...base, '--lang', 'en']);
    const koScan = await cli(['scan', ...base, '--lang', 'ko']);
    expect(enScan.code).toBe(0);
    expect(enScan.out).toContain('orphan');
    expect(enScan.out).toContain('2 orphaned slot(s) with chats, 2 skipped, 1 ok.');
    expect(koScan.out).toContain('고아');
    expect(koScan.out).toContain('채팅이 있는 고아 칸 2개, 건너뜀 2개, 정상 1개.');
  });

  it('priority is --lang > CHAT_RELINK_LANG > LC_ALL > LC_MESSAGES > LANG, not Korean means English', () => {
    // only the injected argv and env objects are read, never the real process.env
    expect(resolveLang({ argv: ['scan', '--lang', 'en'], env: { CHAT_RELINK_LANG: 'ko', LANG: 'ko_KR.UTF-8' } })).toBe('en');
    expect(resolveLang({ argv: ['--lang=ko'], env: { CHAT_RELINK_LANG: 'en', LANG: 'en_US' } })).toBe('ko');
    expect(resolveLang({ argv: ['--lang', 'fr'], env: { LANG: 'ko_KR' } })).toBe('ko'); // invalid flag falls through
    expect(resolveLang({ argv: ['--lang', 'ko', '--lang', 'en'], env: {} })).toBe('en'); // last one wins
    expect(resolveLang({ env: { CHAT_RELINK_LANG: 'ko', LC_ALL: 'en_US.UTF-8' } })).toBe('ko');
    expect(resolveLang({ env: { LC_ALL: 'ko_KR.UTF-8', LC_MESSAGES: 'en_US', LANG: 'en_US' } })).toBe('ko');
    expect(resolveLang({ env: { LC_MESSAGES: 'ko_KR', LANG: 'en_US' } })).toBe('ko');
    expect(resolveLang({ env: { LANG: 'ko_KR.UTF-8' } })).toBe('ko');
    expect(resolveLang({ env: { LANG: 'de_DE.UTF-8' } })).toBe('en');
    expect(resolveLang({ env: {} })).toBe('en');
    expect(resolveLang({ argv: [], env: { LC_ALL: '', LC_MESSAGES: '', LANG: '' } })).toBe('en'); // empty means unset
    expect(resolveLang({ env: { LANG: 'C' } })).toBe('en');
    expect(resolveLang({ env: { CHAT_RELINK_LANG: 'fr', LANG: 'ko_KR' } })).toBe('ko'); // invalid value ignored
    expect(langFromLocale('KO-kr')).toBe('ko');
  });

  it('the CLI applies the environment variable and lets the flag win', async () => {
    const viaEnv = await cli(['--help'], { CHAT_RELINK_LANG: 'ko' });
    expect(viaEnv.out).toContain('사용법:');
    const flagWins = await cli(['--help', '--lang', 'en'], { CHAT_RELINK_LANG: 'ko', LANG: 'ko_KR.UTF-8' });
    expect(flagWins.out).toContain('Usage:');
  });

  it('usage errors are localized and exit with 2', async () => {
    const r = await cli(['nonsense', '--lang', 'ko']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('알 수 없는 명령 "nonsense"');
    const bad = await cli(['scan', '--lang', 'fr']);
    expect(bad.code).toBe(2);
  });

  it('t() fills placeholders and keeps unknown ones visible', () => {
    expect(t('en', 'scan.header', { dir: '/x' })).toBe('Slots in /x');
    expect(t('en', 'scan.header')).toBe('Slots in {dir}');
  });
});
