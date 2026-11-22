import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import { buildFixture, type Fixture, type FixtureOptions } from '../src/core/fixture';

const created: string[] = [];

afterEach(() => {
  while (created.length) fs.rmSync(created.pop() as string, { recursive: true, force: true });
});

/** A fresh empty temp folder, removed after the test. */
export function tmpDir(prefix = 'chat-relink-test-'): string {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
  created.push(dir);
  return dir;
}

export function makeFixture(opts: Partial<FixtureOptions> = {}): Fixture & { toolHome: string } {
  const root = tmpDir();
  const fx = buildFixture({ root, includeScratch: true, includeSkipped: true, ...opts });
  return { ...fx, toolHome: path.join(root, 'tool-home') };
}
