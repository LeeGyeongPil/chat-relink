import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFixture } from '../src/core/fixture';
import { applyRelink, hashTree, planRelink, undoRelink } from '../src/core/relink';
import { findSlotByPath, rankCandidates, scanStorage } from '../src/core/scan';
import { openDb, readIndex } from '../src/core/stateDb';
import { tmpDir } from './helpers';

// CI runs on Linux while development happens on macOS. These tests pin down the two
// things that differ between them, so a Linux-only failure shows up on any machine:
// the id salt (inode on Linux, birthtime on macOS) and the order of directory listings
// (APFS returns names sorted, ext4 returns them in hash order).

afterEach(() => {
  vi.restoreAllMocks();
});

function fullFlow(platform: NodeJS.Platform) {
  const root = tmpDir();
  const fx = buildFixture({ root, includeScratch: true, includeSkipped: true, platform });
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
  const result = applyRelink(planRelink({ from, to }), { userDataDir: fx.userDataDir, toolHome });
  expect(result.copied).toHaveLength(2);
  expect(result.integrity).toBe('ok');
  expect(undoRelink(result.journal).confirmed).toBe(true);
  // undo: the target is empty again and the source was never touched
  expect(fs.readdirSync(path.join(to.dir, 'chatSessions'))).toEqual([]);
  const db = openDb(path.join(to.dir, 'state.vscdb'), { readOnly: true });
  expect(Object.keys(readIndex(db).entries)).toEqual([]);
  db.close();
  expect(hashTree(from.dir)).toBe(sourceBefore);
}

describe('platform differences (CI on Linux, development on macOS)', () => {
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
    fullFlow(process.platform);
    // the scanner, hashTree and listSessions all went through the reversed listing
    expect(spy.mock.calls.length).toBeGreaterThan(5);
  });
});
