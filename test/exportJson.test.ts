import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportSessions, isExportableSessionData, toExportJson } from '../src/core/exportJson';
import { buildSessionLog, FIXTURE_SESSION_IDS } from '../src/core/fixture';
import { replayLog } from '../src/core/sessionLog';
import { scanStorage } from '../src/core/scan';
import { run } from '../src/cli/index';
import { makeFixture, tmpDir } from './helpers';

describe('export JSON for the official import command (AC-3)', () => {
  it('has a requests array and a responderUsername string, one request per replayed turn', () => {
    const { state } = replayLog(buildSessionLog({ id: FIXTURE_SESSION_IDS.loginBug, title: 'T', turns: 3 }).text);
    const exported = toExportJson(state);
    expect(isExportableSessionData(exported)).toBe(true);
    expect(Array.isArray(exported.requests)).toBe(true);
    expect(typeof exported.responderUsername).toBe('string');
    expect(exported.requests).toHaveLength(state.requests.length);
    expect(exported.requests).toHaveLength(3);
  });

  it('falls back to a default responder name and rejects non-exportable data', () => {
    expect(toExportJson({ requests: [] }).responderUsername).toBe('GitHub Copilot');
    expect(isExportableSessionData({ requests: [] })).toBe(false);
    expect(isExportableSessionData({ requests: 'x', responderUsername: 'a' })).toBe(false);
    expect(isExportableSessionData(null)).toBe(false);
  });

  it('exportSessions writes one file per session', () => {
    const fx = makeFixture();
    const old = scanStorage(fx.storageDir).find((s) => s.id === fx.oldId)!;
    const out = path.join(tmpDir(), 'out');
    const written = exportSessions(old.sessions.map((s) => s.file), out);
    expect(written.map((w) => w.requests).sort()).toEqual([2, 3]);
    for (const w of written) {
      expect(isExportableSessionData(JSON.parse(fs.readFileSync(w.file, 'utf8')))).toBe(true);
    }
  });

  it('the export command writes the files and prints the secrets warning', async () => {
    const fx = makeFixture();
    const out = path.join(tmpDir(), 'exported');
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await run(
      ['export', '--from', fx.oldId.slice(0, 8), '--out', out, '--user-data-dir', fx.userDataDir, '--lang', 'en'],
      { out: (s) => stdout.push(s), err: (s) => stderr.push(s) },
      {},
    );
    expect(code).toBe(0);
    expect(fs.readdirSync(out).sort()).toEqual([`${FIXTURE_SESSION_IDS.loginBug}.json`, `${FIXTURE_SESSION_IDS.cartRefactor}.json`].sort());
    expect(stdout.join('\n')).toMatch(/Wrote 2 file\(s\)/);
    expect(stderr.join('\n')).toMatch(/can contain secrets/);
  });
});
