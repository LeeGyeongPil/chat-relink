import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FIXTURE_SESSION_IDS } from '../src/core/fixture';
import {
  findSlotByPath,
  isRelevant,
  nameScore,
  rankCandidates,
  scanStorage,
  uriToFsPath,
} from '../src/core/scan';
import { makeFixture } from './helpers';

describe('orphan scan (AC-2)', () => {
  it('finds two orphans, skips remote and multi-root with a reason, keeps the current folder ok', () => {
    const fx = makeFixture();
    const slots = scanStorage(fx.storageDir);
    const by = (id: string) => slots.find((s) => s.id === id)!;

    const orphans = slots.filter((s) => s.status === 'orphan');
    expect(orphans.map((s) => s.id).sort()).toEqual([fx.oldId, fx.scratchId!].sort());
    expect(by(fx.oldId).sessions).toHaveLength(2);
    expect(by(fx.scratchId!).sessions).toHaveLength(1);

    expect(by(fx.remoteId!)).toMatchObject({ status: 'skipped', reason: 'remote' });
    expect(by(fx.multiRootId!)).toMatchObject({ status: 'skipped', reason: 'multi-root' });
    expect(by(fx.currentId).status).toBe('ok');
  });

  it('counts a session that exists as .json and .jsonl once and prefers the .jsonl', () => {
    const fx = makeFixture();
    const old = scanStorage(fx.storageDir).find((s) => s.id === fx.oldId)!;
    const files = fs.readdirSync(path.join(old.dir, 'chatSessions'));
    expect(files).toContain(`${FIXTURE_SESSION_IDS.cartRefactor}.json`);
    expect(files).toContain(`${FIXTURE_SESSION_IDS.cartRefactor}.jsonl`);
    expect(old.sessions).toHaveLength(2);
    const cart = old.sessions.find((s) => s.sessionId === FIXTURE_SESSION_IDS.cartRefactor)!;
    expect(cart.format).toBe('jsonl');
    expect(cart.hasJsonTwin).toBe(true);
  });

  it('ranks shop-api first for the renamed folder shop-api-v2', () => {
    const fx = makeFixture();
    const ranked = rankCandidates(scanStorage(fx.storageDir), fx.currentFolder);
    expect(ranked[0]!.slot.id).toBe(fx.oldId);
    expect(ranked[0]!.nameScore).toBe(2);
    // the session mentions <old>/src/login.ts, which also exists in the renamed folder
    expect(ranked[0]!.evidence).toBe(1);
    expect(isRelevant(ranked[0]!)).toBe(true);
    const scratch = ranked.find((c) => c.slot.id === fx.scratchId)!;
    expect(isRelevant(scratch)).toBe(false);
  });

  it('gives the same slots, sessions and ranking when readdir returns names in reverse order', () => {
    const fx = makeFixture();
    const summary = () => {
      const slots = scanStorage(fx.storageDir, 'linux');
      return {
        slots: slots.map((s) => [s.id, s.status, s.reason ?? '', s.sessions.map((x) => `${x.sessionId}.${x.format}`).join(',')]),
        ranked: rankCandidates(slots, fx.currentFolder).map((c) => c.slot.id),
      };
    };
    const normal = summary();
    const real = fs.readdirSync.bind(fs) as (...args: unknown[]) => unknown;
    const spy = vi.spyOn(fs, 'readdirSync').mockImplementation(((...args: unknown[]) => {
      const out = real(...args);
      return Array.isArray(out) ? [...out].reverse() : out;
    }) as typeof fs.readdirSync);
    try {
      expect(summary()).toEqual(normal);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('name scoring: same, containing, similar, unrelated', () => {
    expect(nameScore('/a/shop-api', '/b/Shop_API')).toBe(3);
    expect(nameScore('/a/shop-api', '/b/shop-api-v2')).toBe(2);
    expect(nameScore('/a/shopapi', '/b/shop-apl')).toBe(1);
    expect(nameScore('/a/scratch', '/b/shop-api-v2')).toBe(0);
  });

  it('finds a slot by folder path and tolerates a missing storage folder', () => {
    const fx = makeFixture();
    const slots = scanStorage(fx.storageDir);
    expect(findSlotByPath(slots, fx.currentFolder)!.id).toBe(fx.currentId);
    expect(scanStorage(path.join(fx.root, 'nope'))).toEqual([]);
  });

  it('converts file URIs, including Windows drive letters', () => {
    expect(uriToFsPath('file:///home/u/my%20app', 'linux')).toBe('/home/u/my app');
    expect(uriToFsPath('file:///c%3A/work/app', 'win32')).toBe('c:\\work\\app');
  });
});
