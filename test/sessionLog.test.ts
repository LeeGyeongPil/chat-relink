import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLegacyJson, buildSessionLog, FIXTURE_SESSION_IDS } from '../src/core/fixture';
import { previewFile } from '../src/core/preview';
import { readSessionFile, replayLog, SessionLogError } from '../src/core/sessionLog';
import { tmpDir } from './helpers';

const spec = { id: FIXTURE_SESSION_IDS.loginBug, title: 'Fix login bug', turns: 3 };

describe('session log replay (AC-3)', () => {
  it('replays kind 0-3 entries to the final state', () => {
    const lines = [
      { kind: 0, v: { version: 3, sessionId: 's', requests: [] } },
      { kind: 2, k: ['requests'], v: [{ message: { text: 'a' } }, { message: { text: 'b' } }] },
      { kind: 1, k: ['customTitle'], v: 'Hello' },
      { kind: 2, k: ['requests'], i: 1, v: [{ message: { text: 'c' } }] }, // truncate to 1, then push
      { kind: 1, k: ['tmp'], v: 1 },
      { kind: 3, k: ['tmp'] },
    ];
    const { state, warnings } = replayLog(lines.map((l) => JSON.stringify(l)).join('\n'));
    expect(warnings).toEqual([]);
    expect(state.customTitle).toBe('Hello');
    expect(state.requests.map((r) => r.message?.text)).toEqual(['a', 'c']);
    expect('tmp' in state).toBe(false);
  });

  it('gives the expected title and turn count for a built session', () => {
    const { state } = replayLog(buildSessionLog(spec).text);
    expect(state.customTitle).toBe('Fix login bug');
    expect(state.requests).toHaveLength(3);
    expect((state.requests[2]!.response as Array<{ value: string }>)[0]!.value).toBe('answer 2');
  });

  it('accepts a UTF-8 BOM', () => {
    const { state } = replayLog(`﻿${buildSessionLog(spec).text}`);
    expect(state.requests).toHaveLength(3);
  });

  it('keeps the earlier lines and warns when the last line is truncated', () => {
    const text = buildSessionLog(spec).text.trimEnd();
    const cut = text.slice(0, text.length - 12); // damages the final customTitle entry
    const { state, warnings } = replayLog(cut);
    expect(state.requests).toHaveLength(3);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/truncated or damaged/);
  });

  it('rejects a log without an initial entry', () => {
    expect(() => replayLog('{"kind":1,"k":["x"],"v":1}\n')).toThrowError(
      new SessionLogError('Log file is missing an initial entry'),
    );
    expect(() => replayLog('')).toThrowError('Empty log file');
  });

  it('skips unknown kinds and broken paths with a warning instead of failing', () => {
    const text = [
      { kind: 0, v: { requests: [] } },
      { kind: 9, k: ['x'], v: 1 },
      { kind: 1, k: ['a', 'b', 'c'], v: 1 },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n');
    const { warnings } = replayLog(text);
    expect(warnings).toHaveLength(2);
  });

  it('reads legacy .json sessions and previews them', () => {
    const dir = tmpDir();
    const file = path.join(dir, `${spec.id}.json`);
    fs.writeFileSync(file, buildLegacyJson(spec));
    const r = readSessionFile(file);
    expect(r.format).toBe('json');
    expect(r.state.requests).toHaveLength(3);
    expect(previewFile(file)).toMatchObject({ title: 'Fix login bug', turns: 3, format: 'json' });
  });

  it('previewFile reports damaged files instead of throwing', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'broken.jsonl');
    fs.writeFileSync(file, '{"kind":1,"k":["x"],"v":1}\n');
    const p = previewFile(file);
    expect(p.error).toBe('Log file is missing an initial entry');
    expect(p.turns).toBe(0);
  });
});
