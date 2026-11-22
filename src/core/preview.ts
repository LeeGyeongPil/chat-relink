import path from 'node:path';
import { readSessionFile, type SessionFormat, type SessionState } from './sessionLog';

export interface SessionPreview {
  sessionId: string;
  title: string;
  turns: number;
  /** Epoch ms of the last request, else the creation date, else undefined. */
  lastDate: number | undefined;
  format: SessionFormat;
  warnings: string[];
  /** Set when the file could not be replayed at all. */
  error?: string;
}

const TITLE_MAX = 60;

export function titleOf(state: SessionState): string {
  if (typeof state.customTitle === 'string' && state.customTitle.trim()) return state.customTitle.trim();
  const first = state.requests[0]?.message?.text;
  if (typeof first === 'string' && first.trim()) {
    const flat = first.trim().replace(/\s+/g, ' ');
    return flat.length > TITLE_MAX ? `${flat.slice(0, TITLE_MAX - 1)}…` : flat;
  }
  return '(untitled)';
}

export function lastDateOf(state: SessionState): number | undefined {
  let last: number | undefined;
  for (const r of state.requests) {
    if (typeof r.timestamp === 'number' && (last === undefined || r.timestamp > last)) last = r.timestamp;
  }
  return last ?? (typeof state.creationDate === 'number' ? state.creationDate : undefined);
}

export function summarize(state: SessionState, sessionId: string, format: SessionFormat, warnings: string[]): SessionPreview {
  return { sessionId, title: titleOf(state), turns: state.requests.length, lastDate: lastDateOf(state), format, warnings };
}

/** Replay one session file and summarize it; never throws (errors land in `error`). */
export function previewFile(file: string): SessionPreview {
  const sessionId = path.basename(file).replace(/\.jsonl?$/, '');
  try {
    const r = readSessionFile(file);
    return summarize(r.state, sessionId, r.format, r.warnings);
  } catch (e) {
    return {
      sessionId,
      title: '(unreadable)',
      turns: 0,
      lastDate: undefined,
      format: file.endsWith('.jsonl') ? 'jsonl' : 'json',
      warnings: [],
      error: (e as Error).message,
    };
  }
}

export function formatDate(ms: number | undefined): string {
  return ms === undefined ? '-' : new Date(ms).toISOString().slice(0, 10);
}
