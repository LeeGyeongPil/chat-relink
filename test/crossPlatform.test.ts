import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFixture, FIXTURE_STATS } from '../src/core/fixture';
import { defaultUserDataDir, PRODUCTS, toolHomeDir, type PathEnv } from '../src/core/paths';
import { applyRelink, hashTree, planRelink, undoRelink } from '../src/core/relink';
import { findSlotByPath, rankCandidates, scanStorage } from '../src/core/scan';
import { openDb, readIndex } from '../src/core/stateDb';
import { computeFolderId } from '../src/core/workspaceId';
import { tmpDir } from './helpers';

// CI runs on Linux while development happens on macOS. Nothing here reads the host's
// platform, birthtime, inode or home folder: the platform is an argument, the stats are
// fixed fake values, and directory listings are reversed on purpose (ext4 returns names
// in hash order, APFS sorted).

afterEach(() => {
  vi.restoreAllMocks();
});

function fullFlow(platform: NodeJS.Platform) {
  const root = tmpDir();
  const fx = buildFixture({ root, includeScratch: true, includeSkipped: true, platform });
  // the ids come from the injected fake stats, never from the real folders
  expect(fx.oldId).toBe(computeFolderId(fx.oldFolder, platform, FIXTURE_STATS['shop-api']));
  expect(fx.currentId).toBe(computeFolderId(fx.currentFolder, platform, FIXTURE_STATS['shop-api']));
  expect(fx.currentId).not.toBe(fx.oldId);

  const slots = scanStorage(fx.storageDir, platform);
  const orphans = slots.filter((s) => s.status === 'orphan').map((s) => s.id).sort();
  expect(orphans).toEqual([fx.oldId, fx.scratchId!].sort());

  const ranked = rankCandidates(slots, fx.currentFolder);
  expect(ranked[0]!.slot.id).toBe(fx.oldId);

  const from = slots.find((s) => s.id === fx.oldId)!;
  const to = findSlotByPath(slots, fx.currentFolder)!;
  expect(to.id).toBe(fx.currentId);
  const toolHome = path.join(root, 'tool-home');
  const sourceBefore = hashTree(from.dir);
  const result = applyRelink(planRelink({ from, to }), {
    userDataDir: fx.userDataDir,
    toolHome,
    checkRunning: () => ({ state: 'none', lockFile: path.join(fx.userDataDir, 'code.lock') }),
  });
  expect(result.copied).toHaveLength(2);
  expect(result.integrity).toBe('ok');
  expect(undoRelink(result.journal, { checkRunning: () => ({ state: 'none', lockFile: '' }) }).confirmed).toBe(true);
  // undo: the target is empty again and the source was never touched
  expect(fs.readdirSync(path.join(to.dir, 'chatSessions')).sort()).toEqual([]);
  const db = openDb(path.join(to.dir, 'state.vscdb'), { readOnly: true });
  expect(Object.keys(readIndex(db).entries)).toEqual([]);
  db.close();
  expect(hashTree(from.dir)).toBe(sourceBefore);
}

describe('platform differences with injected inputs (AC-1)', () => {
  it('scan, relink and undo work with the Linux id rule (inode salt)', () => {
    fullFlow('linux');
  });

  it('scan, relink and undo work with the macOS id rule (birthtime salt)', () => {
    fullFlow('darwin');
  });

  it('results do not depend on the order of directory listings', () => {
    const real = fs.readdirSync.bind(fs) as (...args: unknown[]) => unknown;
    // Reverse every listing, as an unsorted file system may return it.
    const spy = vi.spyOn(fs, 'readdirSync').mockImplementation(((...args: unknown[]) => {
      const out = real(...args);
      return Array.isArray(out) ? [...out].reverse() : out;
    }) as typeof fs.readdirSync);
    fullFlow('linux');
    // the scanner, hashTree and listSessions all went through the reversed listing
    expect(spy.mock.calls.length).toBeGreaterThan(5);
  });
});

describe('user data folders for three OSes and four products (AC-1)', () => {
  const mac: PathEnv = { platform: 'darwin', homedir: '/fixture/home', env: {} };
  const linux: PathEnv = { platform: 'linux', homedir: '/fixture/home', env: {} };
  const win: PathEnv = { platform: 'win32', homedir: 'C:\\fixture\\home', env: { APPDATA: 'C:\\fixture\\home\\AppData\\Roaming' } };
  const names = { code: 'Code', insiders: 'Code - Insiders', vscodium: 'VSCodium', cursor: 'Cursor' } as const;

  it('computes every OS x product default from the injected env and homedir', () => {
    for (const product of PRODUCTS) {
      const name = names[product];
      expect(defaultUserDataDir(product, mac)).toBe(`/fixture/home/Library/Application Support/${name}`);
      expect(defaultUserDataDir(product, linux)).toBe(`/fixture/home/.config/${name}`);
      expect(defaultUserDataDir(product, win)).toBe(`C:\\fixture\\home\\AppData\\Roaming\\${name}`);
    }
  });

  it('falls back to the home folder when APPDATA / XDG_CONFIG_HOME are not set, and honours them when set', () => {
    expect(defaultUserDataDir('code', { ...win, env: {} })).toBe('C:\\fixture\\home\\AppData\\Roaming\\Code');
    expect(defaultUserDataDir('code', { ...linux, env: { XDG_CONFIG_HOME: '/fixture/xdg' } })).toBe('/fixture/xdg/Code');
  });

  it('places the tool home under the injected home folder with that platform separator', () => {
    expect(toolHomeDir(linux)).toBe('/fixture/home/.chat-relink');
    expect(toolHomeDir(win)).toBe('C:\\fixture\\home\\.chat-relink');
    expect(toolHomeDir({ ...linux, env: { CHAT_RELINK_HOME: '/fixture/tool' } })).toBe('/fixture/tool');
  });
});
