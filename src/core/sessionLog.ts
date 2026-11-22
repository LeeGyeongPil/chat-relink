import { cm } from './msg';
import fs from 'node:fs';

/** A replayed chat session (only the fields chat-relink cares about are typed). */
export interface SessionState {
  version?: number;
  sessionId?: string;
  creationDate?: number;
  customTitle?: string;
  initialLocation?: unknown;
  responderUsername?: unknown;
  requests: SessionRequest[];
  [key: string]: unknown;
}

export interface SessionRequest {
  requestId?: string;
  timestamp?: number;
  message?: { text?: string; [key: string]: unknown };
  response?: unknown;
  [key: string]: unknown;
}

export type SessionFormat = 'jsonl' | 'json';

export interface ReplayResult {
  state: SessionState;
  warnings: string[];
}

export class SessionLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionLogError';
  }
}

const EntryKind = { Initial: 0, Set: 1, Push: 2, Delete: 3 } as const;

interface LogEntry {
  kind: number;
  k?: Array<string | number>;
  v?: unknown;
  i?: number;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function normalize(raw: unknown): SessionState {
  const state = (raw ?? {}) as SessionState;
  if (!Array.isArray(state.requests)) state.requests = [];
  return state;
}

/**
 * Replay a `.jsonl` mutation log (Code - OSS `objectMutationLog.ts`):
 * kind 0 initial state, 1 set, 2 push (optionally truncating to length `i`), 3 delete.
 * A damaged last line is reported as a warning and the earlier lines are kept.
 */
export function replayLog(input: string): ReplayResult {
  const warnings: string[] = [];
  const lines = stripBom(input).split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) throw new SessionLogError(cm('log.empty'));

  let state: SessionState | undefined;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n] as string;
    let entry: LogEntry;
    try {
      entry = JSON.parse(line) as LogEntry;
    } catch {
      if (n === lines.length - 1 && n > 0) {
        warnings.push(cm('log.truncated', { n: n + 1 }));
        break;
      }
      throw new SessionLogError(cm('log.badLine', { n: n + 1 }));
    }
    if (state === undefined) {
      if (entry.kind !== EntryKind.Initial) {
        throw new SessionLogError(cm('log.noInitial'));
      }
      state = normalize(entry.v);
      continue;
    }
    if (entry.kind === EntryKind.Initial) {
      state = normalize(entry.v);
      continue;
    }
    const path = entry.k;
    if (!Array.isArray(path) || path.length === 0) {
      warnings.push(cm('log.noPath', { n: n + 1 }));
      continue;
    }
    let parent: any = state;
    for (let i = 0; i < path.length - 1 && parent != null; i++) parent = parent[path[i] as string];
    const last = path[path.length - 1] as string;
    if (parent == null || typeof parent !== 'object') {
      warnings.push(cm('log.pathMissing', { n: n + 1, path: path.join('.') }));
      continue;
    }
    if (entry.kind === EntryKind.Set) {
      parent[last] = entry.v;
    } else if (entry.kind === EntryKind.Delete) {
      delete parent[last];
    } else if (entry.kind === EntryKind.Push) {
      const arr = parent[last];
      if (!Array.isArray(arr)) {
        warnings.push(cm('log.notArray', { n: n + 1, path: path.join('.') }));
        continue;
      }
      if (typeof entry.i === 'number') arr.length = Math.min(entry.i, arr.length);
      if (Array.isArray(entry.v)) arr.push(...entry.v);
    } else {
      warnings.push(cm('log.unknownKind', { n: n + 1, kind: String(entry.kind) }));
    }
  }
  return { state: state as SessionState, warnings };
}

/** Legacy single-document `.json` sessions. */
export function parseLegacyJson(input: string): ReplayResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stripBom(input));
  } catch {
    throw new SessionLogError(cm('log.fileBadJson'));
  }
  if (raw === null || typeof raw !== 'object') {
    throw new SessionLogError(cm('log.fileNotObject'));
  }
  return { state: normalize(raw), warnings: [] };
}

export interface ReadSession extends ReplayResult {
  format: SessionFormat;
  file: string;
}

export function formatOf(file: string): SessionFormat {
  return file.endsWith('.jsonl') ? 'jsonl' : 'json';
}

export function readSessionFile(file: string): ReadSession {
  const text = fs.readFileSync(file, 'utf8');
  const format = formatOf(file);
  const result = format === 'jsonl' ? replayLog(text) : parseLegacyJson(text);
  return { ...result, format, file };
}
