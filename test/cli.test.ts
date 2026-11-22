import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli/index';
import { runDemo } from '../src/cli/demo';
import { writeLock } from '../src/core/fixture';
import { hashTree } from '../src/core/relink';
import { defaultUserDataDir, resolveUserDataDir, userDataFromStorageUri } from '../src/core/paths';
import { makeFixture } from './helpers';

async function cli(args: string[], env: Record<string, string | undefined>) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(args, { out: (s) => out.push(s), err: (s) => err.push(s) }, env);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('CLI commands and exit codes', () => {
  it('relink: dry run by default, --apply writes, undo reverts', async () => {
    const fx = makeFixture();
    const env = { CHAT_RELINK_HOME: fx.toolHome, CHAT_RELINK_LANG: 'en' };
    const common = ['--user-data-dir', fx.userDataDir];

    const before = hashTree(fx.root);
    const dry = await cli(['relink', '--from', 'shop-api', '--to', fx.currentFolder, ...common], env);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain('Dry run: nothing was written');
    expect(hashTree(fx.root)).toBe(before);

    const applied = await cli(['relink', '--from', 'shop-api', '--to', fx.currentFolder, '--apply', ...common], env);
    expect(applied.code).toBe(0);
    expect(applied.out).toContain('Relinked 2 session(s).');
    expect(applied.out).toContain('integrity_check: ok');
    const journal = /Journal:\s+(.+)/.exec(applied.out)![1]!;

    const undone = await cli(['undo', journal], env);
    expect(undone.code).toBe(0);
    expect(undone.out).toContain('Confirmed');
  });

  it('relink --apply exits with 3 and the "VS Code is running" message while a live PID holds the lock', async () => {
    const fx = makeFixture();
    writeLock(fx.userDataDir, process.pid);
    const before = hashTree(fx.root);
    const r = await cli(
      ['relink', '--from', fx.oldId.slice(0, 8), '--to', fx.currentFolder, '--apply', '--user-data-dir', fx.userDataDir],
      { CHAT_RELINK_HOME: fx.toolHome, CHAT_RELINK_LANG: 'en' },
    );
    expect(r.code).toBe(3);
    expect(r.err).toMatch(/VS Code is running/);
    expect(hashTree(fx.root)).toBe(before);
  });

  it('prints the running-VS-Code error in Korean with --lang ko', async () => {
    const fx = makeFixture();
    writeLock(fx.userDataDir, process.pid);
    const r = await cli(
      ['relink', '--from', fx.oldId.slice(0, 8), '--to', fx.currentFolder, '--apply', '--user-data-dir', fx.userDataDir, '--lang', 'ko'],
      { CHAT_RELINK_HOME: fx.toolHome },
    );
    expect(r.code).toBe(3);
    expect(r.err).toContain('VS Code 가 실행 중입니다');
    expect(r.err).not.toMatch(/is running/);
  });

  it('finds the target slot when --to is a symlink to the folder (macOS /tmp vs /private/tmp)', async () => {
    const fx = makeFixture();
    const link = path.join(fx.root, 'link-to-current');
    fs.symlinkSync(fx.currentFolder, link, 'dir');
    const r = await cli(
      ['relink', '--from', fx.oldId.slice(0, 8), '--to', link, '--user-data-dir', fx.userDataDir],
      { CHAT_RELINK_HOME: fx.toolHome, CHAT_RELINK_LANG: 'en' },
    );
    expect(r.code).toBe(0);
    expect(r.out).toContain('Dry run');
  });

  it('exit codes: usage 2, unknown slot, target without a slot 5', async () => {
    const fx = makeFixture();
    const env = { CHAT_RELINK_LANG: 'en' };
    const base = ['--user-data-dir', fx.userDataDir];
    expect((await cli(['relink', '--from', 'shop-api', ...base], env)).code).toBe(2);
    expect((await cli(['show', 'does-not-exist', ...base], env)).code).toBe(1);
    expect((await cli(['show'], env)).code).toBe(2);
    const noSlot = path.join(fx.root, 'projects', 'never-opened');
    fs.mkdirSync(noSlot);
    const r = await cli(['relink', '--from', 'shop-api', '--to', noSlot, ...base], env);
    expect(r.code).toBe(5);
    expect(r.err).toMatch(/Open it in VS Code once/);
    expect((await cli(['scan', '--user-data-dir', path.join(fx.root, 'nowhere')], env)).code).toBe(1);
  });

  it('show lists sessions with turns and dates; --json is parseable', async () => {
    const fx = makeFixture();
    const env = { CHAT_RELINK_LANG: 'en' };
    const text = await cli(['show', 'shop-api', '--user-data-dir', fx.userDataDir], env);
    expect(text.code).toBe(0);
    expect(text.out).toMatch(/3\s+2026-10-01\s+jsonl\s+Fix login bug/);
    expect(text.out).toContain('legacy .json');
    const json = await cli(['show', 'shop-api', '--json', '--user-data-dir', fx.userDataDir], env);
    expect(JSON.parse(json.out).sessions).toHaveLength(2);
    const scan = JSON.parse((await cli(['scan', '--json', '--user-data-dir', fx.userDataDir, '--current', fx.currentFolder], env)).out);
    expect(scan.orphans).toBe(2);
    expect(scan.candidates[0].id).toBe(fx.oldId);
  });

  it('run() leaves the process warning listeners alone (only the real CLI process filters them)', async () => {
    const fx = makeFixture();
    const env = { CHAT_RELINK_HOME: fx.toolHome, CHAT_RELINK_LANG: 'en' };
    const before = process.listeners('warning');
    const applied = await cli(['relink', '--from', 'shop-api', '--to', fx.currentFolder, '--apply', '--user-data-dir', fx.userDataDir], env);
    expect(applied.code).toBe(0);
    const journal = /Journal:\s+(.+)/.exec(applied.out)![1]!;
    expect((await cli(['undo', journal], env)).code).toBe(0);
    expect((await cli(['demo'], env)).code).toBe(0);
    expect(process.listeners('warning')).toEqual(before);
  });

  it('--version prints the package version', async () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
    expect((await cli(['--version'], {})).out).toBe(pkg.version);
  });
});

describe('demo (AC-10)', () => {
  it('prints the whole story on a synthetic fixture and cleans up after itself', () => {
    const lines: string[] = [];
    const summary = runDemo({ out: (l) => lines.push(l) }, 'en');
    const text = lines.join('\n');
    for (const expected of [
      'orphans: 1',
      'relinked: 2',
      'integrity: ok',
      'external entry lost after flush: true',
      'undo: restored',
      'running guard: running, exit 3',
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).toContain('practice fixture');
    expect(summary.guardExit).toBe(3);
    expect(fs.existsSync(summary.dir)).toBe(false);
  });

  it('is localized but keeps the machine-checkable result lines', () => {
    const lines: string[] = [];
    runDemo({ out: (l) => lines.push(l) }, 'ko');
    const text = lines.join('\n');
    expect(text).toContain('연습용 합성 데이터');
    expect(text).toContain('relinked: 2');
  });
});

describe('user data folder resolution', () => {
  const env = { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' };
  it('knows the per-OS and per-product defaults', () => {
    expect(defaultUserDataDir('code', { platform: 'darwin', home: '/fixture/home', env: {} })).toBe('/fixture/home/Library/Application Support/Code');
    expect(defaultUserDataDir('cursor', { platform: 'linux', home: '/home/u', env: {} })).toBe('/home/u/.config/Cursor');
    expect(defaultUserDataDir('insiders', { platform: 'linux', home: '/home/u', env: { XDG_CONFIG_HOME: '/x' } })).toBe('/x/Code - Insiders');
    expect(defaultUserDataDir('vscodium', { platform: 'win32', home: 'C:\\Users\\u', env })).toBe('C:\\Users\\u\\AppData\\Roaming\\VSCodium');
  });
  it('explicit option beats the environment variable beats the default', () => {
    const pe = { platform: 'linux' as const, home: '/home/u', env: { CHAT_RELINK_USER_DATA_DIR: '/env/dir' } };
    expect(resolveUserDataDir({ userDataDir: '/flag/dir' }, pe)).toBe('/flag/dir');
    expect(resolveUserDataDir({}, pe)).toBe('/env/dir');
    expect(resolveUserDataDir({}, { ...pe, env: {} })).toBe('/home/u/.config/Code');
  });
  it('derives the user data folder from an extension storage path', () => {
    expect(userDataFromStorageUri('/u/Code/User/workspaceStorage/abc/pub.name')).toBe('/u/Code');
    expect(userDataFromStorageUri('/somewhere/else')).toBeUndefined();
  });
});
