import { cm } from './msg';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { previewFile, type SessionPreview } from './preview';
import { checkRunning, type RunningCheck } from './runningGuard';
import type { Slot } from './scan';
import {
  backupDb,
  INDEX_ENTRY_LIMIT,
  integrityCheck,
  openDb,
  readIndex,
  snapshotOtherKeys,
  withTransaction,
  writeIndex,
  type IndexEntry,
} from './stateDb';

/** Exit codes shared with the CLI. */
export const EXIT = { ok: 0, failure: 1, usage: 2, running: 3, verify: 4, noTarget: 5 } as const;

export class RelinkError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    /** Optional message key + params so the CLI can print the error in the chosen language. */
    public readonly i18n?: { key: 'error.running' | 'error.runningUndo'; params: Record<string, string | number> },
  ) {
    super(message);
    this.name = 'RelinkError';
  }
}

export type ItemAction = 'copy' | 'skip';

export interface PlanItem {
  sessionId: string;
  file: string;
  dstFile: string;
  action: ItemAction;
  /** Why it is skipped. */
  reason?: 'exists' | 'unreadable';
  title: string;
  turns: number;
  lastDate: number | undefined;
  warnings: string[];
}

export interface RelinkPlan {
  from: { id: string; dir: string; fsPath?: string };
  to: { id: string; dir: string; fsPath?: string };
  items: PlanItem[];
  warnings: string[];
  indexCountBefore: number;
  indexCountAfter: number;
  overLimit: boolean;
}

export interface PlanOptions {
  from: Slot;
  to: Slot;
  /** Session ids (or unique prefixes) to include; default all. */
  sessionIds?: string[];
}

function dbFileOf(slot: { dir: string }): string {
  return path.join(slot.dir, 'state.vscdb');
}

export function selectSessions(from: Slot, wanted: string[] | undefined): Slot['sessions'] {
  if (!wanted || wanted.length === 0) return from.sessions;
  const picked = new Set<string>();
  for (const w of wanted) {
    const hits = from.sessions.filter((s) => s.sessionId === w || (w.length >= 4 && s.sessionId.startsWith(w)));
    if (hits.length === 0) {
      throw new RelinkError(cm('core.noSession', { w, slot: from.id.slice(0, 8) }), EXIT.usage);
    }
    if (hits.length > 1) {
      throw new RelinkError(cm('core.ambiguous', { w, count: hits.length }), EXIT.usage);
    }
    picked.add((hits[0] as Slot['sessions'][number]).sessionId);
  }
  return from.sessions.filter((s) => picked.has(s.sessionId));
}

/** Build the dry-run plan. Reads only; never writes. */
export function planRelink(opts: PlanOptions): RelinkPlan {
  const { from, to } = opts;
  if (from.id === to.id) throw new RelinkError(cm('core.sameSlot'), EXIT.usage);
  if (from.status !== 'orphan') {
    throw new RelinkError(
      cm('core.notOrphan', { id: from.id.slice(0, 8), status: `${from.status}${from.reason ? `:${from.reason}` : ''}` }),
      EXIT.usage,
    );
  }
  if (!fs.existsSync(dbFileOf(to))) {
    throw new RelinkError(
      cm('core.noTargetDb', { id: to.id.slice(0, 8) }),
      EXIT.noTarget,
    );
  }
  const chosen = selectSessions(from, opts.sessionIds);
  const items: PlanItem[] = chosen.map((s) => {
    const base = path.basename(s.file);
    const dstFile = path.join(to.dir, 'chatSessions', base);
    const twinExists = ['.json', '.jsonl'].some((ext) =>
      fs.existsSync(path.join(to.dir, 'chatSessions', `${s.sessionId}${ext}`)),
    );
    const pv: SessionPreview = previewFile(s.file);
    const common = { sessionId: s.sessionId, file: s.file, dstFile, title: pv.title, turns: pv.turns, lastDate: pv.lastDate, warnings: pv.warnings };
    if (pv.error) return { ...common, action: 'skip', reason: 'unreadable', warnings: [...pv.warnings, pv.error] };
    if (twinExists) return { ...common, action: 'skip', reason: 'exists' };
    return { ...common, action: 'copy' };
  });

  const db = openDb(dbFileOf(to), { readOnly: true });
  let before: number;
  try {
    before = Object.keys(readIndex(db).entries).length;
  } catch (e) {
    throw new RelinkError((e as Error).message, EXIT.failure);
  } finally {
    db.close();
  }
  const adding = items.filter((i) => i.action === 'copy').length;
  const after = before + adding;
  const warnings: string[] = [];
  if (after > INDEX_ENTRY_LIMIT) {
    warnings.push(
      cm('core.indexOverLimit', { after, limit: INDEX_ENTRY_LIMIT }),
    );
  }
  return {
    from: { id: from.id, dir: from.dir, ...(from.fsPath ? { fsPath: from.fsPath } : {}) },
    to: { id: to.id, dir: to.dir, ...(to.fsPath ? { fsPath: to.fsPath } : {}) },
    items,
    warnings,
    indexCountBefore: before,
    indexCountAfter: after,
    overLimit: after > INDEX_ENTRY_LIMIT,
  };
}

// ------------------------------------------------------------------ journal

export interface Journal {
  version: 1;
  createdAt: string;
  status: 'started' | 'applied' | 'rolled-back' | 'undone';
  userDataDir: string;
  fromId: string;
  toId: string;
  dstDir: string;
  dstDb: string;
  backup: string;
  copiedFiles: string[];
  addedSessionIds: string[];
  dbSha256After?: string;
}

export function sha256File(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Deterministic hash of a directory tree (relative names + contents). */
export function hashTree(dir: string): string {
  const h = createHash('sha256');
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        h.update(path.relative(dir, p));
        h.update(fs.readFileSync(p));
      }
    }
  };
  walk(dir);
  return h.digest('hex');
}

function writeJournal(file: string, j: Journal): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(j, null, 2));
}

export function readJournal(file: string): Journal {
  let j: Journal;
  try {
    j = JSON.parse(fs.readFileSync(file, 'utf8')) as Journal;
  } catch {
    throw new RelinkError(cm('core.journalMissing', { file }), EXIT.failure);
  }
  if (j.version !== 1 || typeof j.dstDb !== 'string' || typeof j.backup !== 'string' || !Array.isArray(j.copiedFiles)) {
    throw new RelinkError(cm('core.journalShape', { file }), EXIT.failure);
  }
  return j;
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:.]/g, '').replace('Z', '');
}

function removeSidecars(dbFile: string): void {
  for (const suffix of ['-wal', '-shm']) fs.rmSync(`${dbFile}${suffix}`, { force: true });
}

function restoreBackup(j: Journal): void {
  removeSidecars(j.dstDb);
  fs.copyFileSync(j.backup, j.dstDb);
}

// -------------------------------------------------------------------- apply

export interface ApplyContext {
  userDataDir: string;
  /** Folder for journals and backups (default: ~/.chat-relink). */
  toolHome: string;
  now?: Date;
  /** Test hook: make the verification step fail. */
  injectVerifyFault?: boolean;
  /** Injected for tests. */
  checkRunning?: (userDataDir: string) => RunningCheck;
}

export interface ApplyResult {
  backup: string;
  journal: string;
  copied: string[];
  skipped: Array<{ sessionId: string; reason: string }>;
  integrity: string;
  indexCountAfter: number;
  warnings: string[];
}

export class VerifyError extends RelinkError {
  constructor(
    message: string,
    public readonly failures: string[],
    public readonly journal: string,
  ) {
    super(message, EXIT.verify);
    this.name = 'VerifyError';
  }
}

export function applyRelink(plan: RelinkPlan, ctx: ApplyContext): ApplyResult {
  const running = (ctx.checkRunning ?? checkRunning)(ctx.userDataDir);
  const warnings = [...plan.warnings];
  if (running.state === 'running') {
    throw new RelinkError(
      cm('core.running', { pid: running.pid ?? '?', lockFile: running.lockFile }),
      EXIT.running,
      { key: 'error.running', params: { pid: running.pid ?? '?', lockFile: running.lockFile } },
    );
  }
  if (running.state === 'stale') {
    warnings.push(cm('core.staleLock', { lockFile: running.lockFile }));
  }

  const dstDb = dbFileOf(plan.to);
  const toCopy = plan.items.filter((i) => i.action === 'copy');
  const skipped = plan.items.filter((i) => i.action === 'skip').map((i) => ({ sessionId: i.sessionId, reason: i.reason ?? 'skipped' }));

  const now = ctx.now ?? new Date();
  const id = `${stamp(now)}-${plan.to.id.slice(0, 8)}`;
  const backup = path.join(ctx.toolHome, 'backups', `${id}.state.vscdb.bak`);
  const journalFile = path.join(ctx.toolHome, 'journals', `${id}.json`);
  fs.mkdirSync(path.dirname(backup), { recursive: true });

  // 1. read the source index entries and the target's state before touching anything
  const srcEntries: Record<string, IndexEntry> = {};
  const srcDbFile = dbFileOf(plan.from);
  if (fs.existsSync(srcDbFile)) {
    const sdb = openDb(srcDbFile, { readOnly: true });
    try {
      Object.assign(srcEntries, readIndex(sdb).entries);
    } catch {
      warnings.push(cm('core.sourceIndexUnreadable'));
    } finally {
      sdb.close();
    }
  }
  const preDb = openDb(dstDb, { readOnly: true });
  let otherKeysBefore: Map<string, string>;
  let indexBefore: string[];
  try {
    indexBefore = Object.keys(readIndex(preDb).entries);
    otherKeysBefore = snapshotOtherKeys(preDb);
  } catch (e) {
    throw new RelinkError((e as Error).message, EXIT.failure);
  } finally {
    preDb.close();
  }
  const srcHashBefore = hashTree(plan.from.dir);

  // 2. backup + journal first, so an interrupted run can still be undone
  backupDb(dstDb, backup);
  const journal: Journal = {
    version: 1,
    createdAt: now.toISOString(),
    status: 'started',
    userDataDir: ctx.userDataDir,
    fromId: plan.from.id,
    toId: plan.to.id,
    dstDir: plan.to.dir,
    dstDb,
    backup,
    copiedFiles: [],
    addedSessionIds: [],
  };
  writeJournal(journalFile, journal);

  const rollback = (): void => {
    restoreBackup(journal);
    for (const f of journal.copiedFiles) fs.rmSync(f, { force: true });
    journal.status = 'rolled-back';
    writeJournal(journalFile, journal);
  };

  try {
    // 3. copy session files, never overwriting
    fs.mkdirSync(path.join(plan.to.dir, 'chatSessions'), { recursive: true });
    const copiedIds: string[] = [];
    for (const item of toCopy) {
      try {
        fs.copyFileSync(item.file, item.dstFile, fs.constants.COPYFILE_EXCL);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
          skipped.push({ sessionId: item.sessionId, reason: 'exists' });
          continue;
        }
        throw e;
      }
      journal.copiedFiles.push(item.dstFile);
      copiedIds.push(item.sessionId);
      writeJournal(journalFile, journal);
    }

    // 4. add index entries in one transaction
    const db = openDb(dstDb);
    try {
      withTransaction(db, () => {
        const index = readIndex(db);
        for (const item of toCopy) {
          if (!copiedIds.includes(item.sessionId)) continue;
          if (index.entries[item.sessionId]) continue;
          index.entries[item.sessionId] = srcEntries[item.sessionId] ?? {
            sessionId: item.sessionId,
            title: item.title,
            lastMessageDate: item.lastDate ?? now.getTime(),
            isEmpty: false,
          };
        }
        writeIndex(db, index);
      });
    } finally {
      db.close();
    }
    journal.addedSessionIds = copiedIds.filter((s) => !indexBefore.includes(s));
    writeJournal(journalFile, journal);

    // 5. verify
    const failures = verify({
      dstDir: plan.to.dir,
      dstDb,
      copiedIds,
      otherKeysBefore,
      sourceDir: plan.from.dir,
      srcHashBefore,
      indexBefore,
      inject: ctx.injectVerifyFault === true,
    });
    if (failures.failures.length > 0) {
      rollback();
      throw new VerifyError(
        cm('core.verifyFailed', { failures: failures.failures.join('; ') }),
        failures.failures,
        journalFile,
      );
    }
    journal.status = 'applied';
    journal.dbSha256After = sha256File(dstDb);
    writeJournal(journalFile, journal);
    return {
      backup,
      journal: journalFile,
      copied: copiedIds,
      skipped,
      integrity: failures.integrity,
      indexCountAfter: failures.indexCount,
      warnings,
    };
  } catch (e) {
    if (e instanceof VerifyError) throw e;
    rollback();
    throw new RelinkError(cm('core.rolledBack', { detail: (e as Error).message }), EXIT.failure);
  }
}

interface VerifyInput {
  dstDir: string;
  dstDb: string;
  copiedIds: string[];
  otherKeysBefore: Map<string, string>;
  sourceDir: string;
  srcHashBefore: string;
  indexBefore: string[];
  inject: boolean;
}

function verify(v: VerifyInput): { failures: string[]; integrity: string; indexCount: number } {
  const failures: string[] = [];
  const db = openDb(v.dstDb, { readOnly: true });
  let integrity = 'unknown';
  let indexCount = 0;
  try {
    integrity = integrityCheck(db);
    if (integrity !== 'ok') failures.push(cm('verify.integrity', { result: integrity }));
    const index = readIndex(db); // re-parses the JSON
    indexCount = Object.keys(index.entries).length;
    for (const id of v.copiedIds) {
      if (!index.entries[id]) failures.push(cm('verify.indexMissing', { id }));
      const exists = ['.jsonl', '.json'].some((ext) => fs.existsSync(path.join(v.dstDir, 'chatSessions', `${id}${ext}`)));
      if (!exists) failures.push(cm('verify.fileMissing', { id }));
    }
    for (const id of v.indexBefore) {
      if (!index.entries[id]) failures.push(cm('verify.entryGone', { id }));
    }
    const after = snapshotOtherKeys(db);
    for (const [k, val] of v.otherKeysBefore) {
      if (after.get(k) !== val) failures.push(cm('verify.keyChanged', { key: k }));
    }
  } catch (e) {
    failures.push(cm('verify.reread', { detail: (e as Error).message }));
  } finally {
    db.close();
  }
  if (hashTree(v.sourceDir) !== v.srcHashBefore) failures.push(cm('verify.sourceChanged'));
  if (v.inject) failures.push(cm('verify.injected'));
  return { failures, integrity, indexCount };
}

// --------------------------------------------------------------------- undo

export interface UndoResult {
  mode: 'restored-backup' | 'removed-entries';
  removedFiles: number;
  /** Index entries gone from the target after the undo. */
  removedEntries: number;
  confirmed: boolean;
}

export function undoRelink(
  journalFile: string,
  opts: { checkRunning?: (userDataDir: string) => RunningCheck } = {},
): UndoResult {
  const j = readJournal(journalFile);
  if (j.status === 'undone' || j.status === 'rolled-back') {
    throw new RelinkError(cm(j.status === 'undone' ? 'core.alreadyUndone' : 'core.alreadyRolledBack'), EXIT.failure);
  }
  const running = (opts.checkRunning ?? checkRunning)(j.userDataDir);
  if (running.state === 'running') {
    throw new RelinkError(cm('core.runningUndo', { pid: running.pid ?? '?' }), EXIT.running, {
      key: 'error.runningUndo',
      params: { pid: running.pid ?? '?' },
    });
  }
  if (!fs.existsSync(j.backup)) {
    throw new RelinkError(cm('core.backupGone', { path: j.backup }), EXIT.failure);
  }

  let mode: UndoResult['mode'];
  const unchanged = j.dbSha256After !== undefined && fs.existsSync(j.dstDb) && sha256File(j.dstDb) === j.dbSha256After;
  if (unchanged) {
    // Nothing touched the DB since apply: restore the exact pre-apply state.
    restoreBackup(j);
    mode = 'restored-backup';
  } else {
    // VS Code ran since: keep newer chats and remove only what we added.
    const db = openDb(j.dstDb);
    try {
      withTransaction(db, () => {
        const index = readIndex(db);
        for (const id of j.addedSessionIds) delete index.entries[id];
        writeIndex(db, index);
      });
    } finally {
      db.close();
    }
    mode = 'removed-entries';
  }
  let removedFiles = 0;
  for (const f of j.copiedFiles) {
    if (fs.existsSync(f)) {
      fs.rmSync(f);
      removedFiles++;
    }
  }

  // confirm
  const db = openDb(j.dstDb, { readOnly: true });
  let leftover = 0;
  try {
    const index = readIndex(db);
    leftover = j.addedSessionIds.filter((id) => index.entries[id]).length;
  } finally {
    db.close();
  }
  const confirmed = leftover === 0 && j.copiedFiles.every((f) => !fs.existsSync(f));
  j.status = 'undone';
  writeJournal(journalFile, j);
  return { mode, removedFiles, removedEntries: j.addedSessionIds.length - leftover, confirmed };
}
