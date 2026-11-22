import { cm } from './msg';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';

export const INDEX_KEY = 'chat.ChatSessionStore.index';
/** VS Code trims the index to this many entries (reported for current main). */
export const INDEX_ENTRY_LIMIT = 400;

export interface IndexEntry {
  sessionId: string;
  title?: string;
  lastMessageDate?: number;
  isEmpty?: boolean;
  [key: string]: unknown;
}

export interface ChatIndex {
  version: number;
  entries: Record<string, IndexEntry>;
}

export class StateDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateDbError';
  }
}

const nodeRequire = createRequire(__filename);

/** Lazy load so the VS Code extension (which never needs SQLite) does not depend on it. */
export function openDb(file: string, opts: { readOnly?: boolean } = {}): DatabaseSync {
  let mod: typeof import('node:sqlite');
  try {
    mod = nodeRequire('node:sqlite') as typeof import('node:sqlite');
  } catch {
    throw new StateDbError(cm('db.noSqlite'));
  }
  if (!fs.existsSync(file)) throw new StateDbError(cm('db.notFound', { file }));
  return new mod.DatabaseSync(file, { readOnly: opts.readOnly ?? false });
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8');
  return String(value);
}

export function readKey(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key) as { value: unknown } | undefined;
  return row === undefined ? undefined : asText(row.value);
}

/** Parse the chat index; a missing key is an empty index, an unknown `version` is refused. */
export function readIndex(db: DatabaseSync): ChatIndex {
  const text = readKey(db, INDEX_KEY);
  if (text === undefined) return { version: 1, entries: {} };
  let parsed: ChatIndex;
  try {
    parsed = JSON.parse(text) as ChatIndex;
  } catch {
    throw new StateDbError(cm('db.indexBadJson', { key: INDEX_KEY }));
  }
  if (parsed.version !== 1 || parsed.entries === null || typeof parsed.entries !== 'object') {
    throw new StateDbError(
      cm('db.indexVersion', { key: INDEX_KEY, version: String(parsed.version) }),
    );
  }
  return parsed;
}

export function writeIndex(db: DatabaseSync, index: ChatIndex): void {
  db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run(INDEX_KEY, JSON.stringify(index));
}

/** Consistent single-file copy, safe even when a WAL exists. The target must not exist. */
export function backupDb(file: string, backupPath: string): void {
  if (fs.existsSync(backupPath)) throw new StateDbError(cm('db.backupExists', { path: backupPath }));
  const db = openDb(file, { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
}

export function integrityCheck(db: DatabaseSync): string {
  const row = db.prepare('PRAGMA integrity_check').get() as Record<string, unknown> | undefined;
  return row ? String(Object.values(row)[0]) : 'no result';
}

/** Every key except the chat index, for "unrelated keys survived" checks. */
export function snapshotOtherKeys(db: DatabaseSync): Map<string, string> {
  const rows = db.prepare('SELECT key, value FROM ItemTable WHERE key <> ?').all(INDEX_KEY) as Array<{
    key: string;
    value: unknown;
  }>;
  return new Map(rows.map((r) => [r.key, asText(r.value)]));
}

/** Run `fn` inside BEGIN IMMEDIATE ... COMMIT (ROLLBACK on error). */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* already rolled back */
    }
    throw e;
  }
}

/** Create an empty chat-style state DB (used by fixtures and the demo only). */
export function createStateDb(file: string, index: ChatIndex, extra: Record<string, string> = {}): void {
  const db = (() => {
    const mod = nodeRequire('node:sqlite') as typeof import('node:sqlite');
    return new mod.DatabaseSync(file);
  })();
  try {
    db.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
    writeIndex(db, index);
    for (const [k, v] of Object.entries(extra)) {
      db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run(k, v);
    }
  } finally {
    db.close();
  }
}
