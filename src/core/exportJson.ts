import fs from 'node:fs';
import path from 'node:path';
import { readSessionFile, type SessionState } from './sessionLog';

export interface ExportedSession {
  version: number;
  initialLocation: unknown;
  requests: unknown[];
  responderUsername: string;
  requesterUsername?: string;
  /** Extra metadata; the official import ignores it. */
  sessionId?: string;
  creationDate?: number;
  customTitle?: string;
}

/**
 * Mirror of the precondition VS Code applies before importing a file
 * (`isExportableSessionData`): `requests` is an array and `responderUsername` a string.
 */
export function isExportableSessionData(data: unknown): data is ExportedSession {
  if (data === null || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return Array.isArray(d.requests) && typeof d.responderUsername === 'string';
}

/** Convert a replayed session to the shape of `Chat: Export Chat...`. */
export function toExportJson(state: SessionState): ExportedSession {
  const out: ExportedSession = {
    version: 3,
    initialLocation: state.initialLocation ?? 1,
    requests: state.requests,
    responderUsername: typeof state.responderUsername === 'string' ? state.responderUsername : 'GitHub Copilot',
  };
  if (typeof state.requesterUsername === 'string') out.requesterUsername = state.requesterUsername;
  if (typeof state.sessionId === 'string') out.sessionId = state.sessionId;
  if (typeof state.creationDate === 'number') out.creationDate = state.creationDate;
  if (typeof state.customTitle === 'string') out.customTitle = state.customTitle;
  return out;
}

export interface ExportedFile {
  sessionId: string;
  file: string;
  requests: number;
}

/** Write one export JSON per session file into `outDir`; returns what was written. */
export function exportSessions(sessionFiles: string[], outDir: string): ExportedFile[] {
  fs.mkdirSync(outDir, { recursive: true });
  const written: ExportedFile[] = [];
  for (const sf of sessionFiles) {
    const r = readSessionFile(sf);
    const exported = toExportJson(r.state);
    if (!isExportableSessionData(exported)) continue;
    const sessionId = path.basename(sf).replace(/\.jsonl?$/, '');
    const file = path.join(outDir, `${sessionId}.json`);
    fs.writeFileSync(file, JSON.stringify(exported, null, 2), { mode: 0o600 });
    written.push({ sessionId, file, requests: exported.requests.length });
  }
  return written;
}
