/**
 * Synthetic workspaceStorage builder. It powers the `demo` command and the test suite,
 * and is the only place that creates fake data: your real VS Code folders are never read by it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { computeFolderId, computeRemoteId } from './workspaceId';
import { createStateDb, type ChatIndex } from './stateDb';

export const FIXTURE_SESSION_IDS = {
  loginBug: '11111111-1111-4111-8111-111111111111',
  cartRefactor: '22222222-2222-4222-8222-222222222222',
  throwaway: '33333333-3333-4333-8333-333333333333',
} as const;

const BASE_TIME = Date.parse('2026-10-01T09:00:00Z');

export interface LogSpec {
  id: string;
  title: string;
  turns: number;
  /** Extra text appended to the first question (e.g. a file path mention). */
  mention?: string;
}

export interface BuiltLog {
  text: string;
  lastDate: number;
}

/** A `.jsonl` mutation log in the shape VS Code writes (kind 0 initial, 2 push, 1 set). */
export function buildSessionLog(spec: LogSpec): BuiltLog {
  const initial = {
    version: 3,
    sessionId: spec.id,
    creationDate: BASE_TIME,
    initialLocation: 1,
    responderUsername: 'GitHub Copilot',
    requests: [] as unknown[],
  };
  const lines: unknown[] = [{ kind: 0, v: initial }];
  for (let i = 0; i < spec.turns; i++) {
    const text = i === 0 && spec.mention ? `question 0 ${spec.mention}` : `question ${i}`;
    lines.push({
      kind: 2,
      k: ['requests'],
      v: [{ requestId: `request_${i}`, message: { text }, response: [], timestamp: BASE_TIME + i * 60_000 }],
    });
    lines.push({ kind: 1, k: ['requests', i, 'response'], v: [{ value: `answer ${i}` }] });
  }
  lines.push({ kind: 1, k: ['customTitle'], v: spec.title });
  return { text: lines.map((l) => JSON.stringify(l)).join('\n') + '\n', lastDate: BASE_TIME + (spec.turns - 1) * 60_000 };
}

/** Same session as a legacy single-document `.json`. */
export function buildLegacyJson(spec: LogSpec): string {
  const requests = Array.from({ length: spec.turns }, (_, i) => ({
    requestId: `request_${i}`,
    message: { text: `question ${i}` },
    response: [{ value: `answer ${i}` }],
    timestamp: BASE_TIME + i * 60_000,
  }));
  return JSON.stringify({
    version: 3,
    sessionId: spec.id,
    creationDate: BASE_TIME,
    initialLocation: 1,
    responderUsername: 'GitHub Copilot',
    customTitle: spec.title,
    requests,
  });
}

export interface FixtureOptions {
  /** Empty folder that receives the whole synthetic tree. */
  root: string;
  /** Add a second orphan (`scratch`, one session) whose folder is gone. */
  includeScratch?: boolean;
  /** Add a remote slot and a multi-root slot (skipped by the scanner). */
  includeSkipped?: boolean;
  platform?: NodeJS.Platform;
}

export interface Fixture {
  root: string;
  userDataDir: string;
  storageDir: string;
  /** The renamed folder VS Code opens now. */
  currentFolder: string;
  /** Where the folder used to be (does not exist any more). */
  oldFolder: string;
  oldId: string;
  currentId: string;
  scratchId?: string;
  remoteId?: string;
  multiRootId?: string;
}

function writeSlot(dir: string, folderUri: string | undefined, key: 'folder' | 'workspace'): void {
  fs.mkdirSync(path.join(dir, 'chatSessions'), { recursive: true });
  if (folderUri) fs.writeFileSync(path.join(dir, 'workspace.json'), JSON.stringify({ [key]: folderUri }));
}

function indexOf(entries: Array<{ spec: LogSpec; last: number }>): ChatIndex {
  const out: ChatIndex = { version: 1, entries: {} };
  for (const e of entries) {
    out.entries[e.spec.id] = { sessionId: e.spec.id, title: e.spec.title, lastMessageDate: e.last, isEmpty: false };
  }
  return out;
}

export function buildFixture(opts: FixtureOptions): Fixture {
  const platform = opts.platform ?? process.platform;
  const userDataDir = path.join(opts.root, 'userdata');
  const storageDir = path.join(userDataDir, 'User', 'workspaceStorage');
  const projects = path.join(opts.root, 'projects');
  fs.mkdirSync(storageDir, { recursive: true });
  fs.mkdirSync(projects, { recursive: true });

  const idFor = (p: string): string => computeFolderId(p, platform, fs.statSync(p));

  // The project as it was before the rename.
  const oldFolder = path.join(projects, 'shop-api');
  fs.mkdirSync(path.join(oldFolder, 'src'), { recursive: true });
  fs.writeFileSync(path.join(oldFolder, 'src', 'login.ts'), 'export const login = 1;\n');
  fs.writeFileSync(path.join(oldFolder, 'src', 'cart.ts'), 'export const cart = 2;\n');
  const oldId = idFor(oldFolder);

  const specs: LogSpec[] = [
    { id: FIXTURE_SESSION_IDS.loginBug, title: 'Fix login bug', turns: 3, mention: `${oldFolder}/src/login.ts` },
    { id: FIXTURE_SESSION_IDS.cartRefactor, title: 'Refactor cart', turns: 2 },
  ];
  const oldDir = path.join(storageDir, oldId);
  writeSlot(oldDir, pathToFileURL(oldFolder).href, 'folder');
  const built = specs.map((spec) => ({ spec, ...buildSessionLog(spec) }));
  for (const b of built) fs.writeFileSync(path.join(oldDir, 'chatSessions', `${b.spec.id}.jsonl`), b.text);
  // Same id as both .json and .jsonl: the scanner must count it once and prefer the .jsonl.
  fs.writeFileSync(path.join(oldDir, 'chatSessions', `${FIXTURE_SESSION_IDS.cartRefactor}.json`), buildLegacyJson(specs[1] as LogSpec));
  createStateDb(
    path.join(oldDir, 'state.vscdb'),
    indexOf(built.map((b) => ({ spec: b.spec, last: b.lastDate }))),
    { 'workbench.unrelated': '"old slot value"' },
  );

  let scratchId: string | undefined;
  if (opts.includeScratch) {
    const scratch = path.join(projects, 'scratch');
    fs.mkdirSync(scratch);
    scratchId = idFor(scratch);
    const spec: LogSpec = { id: FIXTURE_SESSION_IDS.throwaway, title: 'Throwaway experiment', turns: 1 };
    const dir = path.join(storageDir, scratchId);
    writeSlot(dir, pathToFileURL(scratch).href, 'folder');
    const b = buildSessionLog(spec);
    fs.writeFileSync(path.join(dir, 'chatSessions', `${spec.id}.jsonl`), b.text);
    createStateDb(path.join(dir, 'state.vscdb'), indexOf([{ spec, last: b.lastDate }]));
    fs.rmSync(scratch, { recursive: true });
  }

  let remoteId: string | undefined;
  let multiRootId: string | undefined;
  if (opts.includeSkipped) {
    const uri = 'vscode-remote://ssh-remote%2Bdevbox/home/dev/shop-api';
    remoteId = computeRemoteId(uri);
    writeSlot(path.join(storageDir, remoteId), uri, 'folder');
    multiRootId = computeRemoteId('file:///workspaces/shop.code-workspace');
    writeSlot(path.join(storageDir, multiRootId), 'file:///workspaces/shop.code-workspace', 'workspace');
  }

  // Rename: the path changes, so VS Code opens a brand-new, empty slot.
  const currentFolder = path.join(projects, 'shop-api-v2');
  fs.renameSync(oldFolder, currentFolder);
  const currentId = idFor(currentFolder);
  const curDir = path.join(storageDir, currentId);
  writeSlot(curDir, pathToFileURL(currentFolder).href, 'folder');
  createStateDb(path.join(curDir, 'state.vscdb'), { version: 1, entries: {} }, { 'workbench.unrelated': '"keep me"' });

  const fx: Fixture = { root: opts.root, userDataDir, storageDir, currentFolder, oldFolder, oldId, currentId };
  if (scratchId) fx.scratchId = scratchId;
  if (remoteId) fx.remoteId = remoteId;
  if (multiRootId) fx.multiRootId = multiRootId;
  return fx;
}

/** Write a fake `code.lock` with the given PID (as a running VS Code would). */
export function writeLock(userDataDir: string, pid: number): string {
  const file = path.join(userDataDir, 'code.lock');
  fs.writeFileSync(file, String(pid));
  return file;
}
