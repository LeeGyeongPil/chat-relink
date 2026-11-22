import fs from 'node:fs';
import path from 'node:path';

export type SlotStatus = 'ok' | 'orphan' | 'skipped';
export type SkipReason = 'remote' | 'multi-root' | 'no-workspace-json' | 'unsupported-uri';

export interface SessionFile {
  sessionId: string;
  /** The file chat-relink reads (`.jsonl` wins over `.json` for the same id). */
  file: string;
  format: 'jsonl' | 'json';
  /** True when a legacy `.json` with the same id also exists. */
  hasJsonTwin: boolean;
}

export interface Slot {
  id: string;
  dir: string;
  /** Raw URI from workspace.json (folder or workspace). */
  uri?: string;
  /** Local folder path when the URI is a `file:` folder. */
  fsPath?: string;
  status: SlotStatus;
  reason?: SkipReason;
  sessions: SessionFile[];
}

/** Convert a `file:` URI to a local path (handles `file:///c%3A/...` on Windows). */
export function uriToFsPath(uri: string, platform: NodeJS.Platform = process.platform): string {
  const u = new URL(uri);
  let p = decodeURIComponent(u.pathname);
  if (/^\/[a-zA-Z]:/.test(p)) {
    p = p.slice(1);
    return platform === 'win32' ? p.replace(/\//g, '\\') : p;
  }
  if (u.host && platform === 'win32') return `\\\\${u.host}${p.replace(/\//g, '\\')}`;
  return p;
}

export function listSessions(slotDir: string): SessionFile[] {
  const dir = path.join(slotDir, 'chatSessions');
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const jsonl = new Set<string>();
  const json = new Set<string>();
  for (const n of names) {
    if (n.endsWith('.jsonl')) jsonl.add(n.slice(0, -6));
    else if (n.endsWith('.json')) json.add(n.slice(0, -5));
  }
  const ids = [...new Set([...jsonl, ...json])].sort();
  return ids.map((id) => {
    const useJsonl = jsonl.has(id);
    return {
      sessionId: id,
      file: path.join(dir, `${id}${useJsonl ? '.jsonl' : '.json'}`),
      format: useJsonl ? 'jsonl' : 'json',
      hasJsonTwin: useJsonl && json.has(id),
    } satisfies SessionFile;
  });
}

function readWorkspaceUri(slotDir: string): { uri?: string; multiRoot: boolean } | undefined {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(slotDir, 'workspace.json'), 'utf8')) as {
      folder?: unknown;
      workspace?: unknown;
    };
    if (typeof meta.folder === 'string') return { uri: meta.folder, multiRoot: false };
    if (typeof meta.workspace === 'string') return { uri: meta.workspace, multiRoot: true };
    return { multiRoot: false };
  } catch {
    return undefined;
  }
}

export function scanSlot(storageDir: string, id: string, platform: NodeJS.Platform = process.platform): Slot {
  const dir = path.join(storageDir, id);
  const sessions = listSessions(dir);
  const meta = readWorkspaceUri(dir);
  if (!meta || !meta.uri) {
    return { id, dir, status: 'skipped', reason: 'no-workspace-json', sessions };
  }
  const base = { id, dir, uri: meta.uri, sessions };
  if (meta.multiRoot) return { ...base, status: 'skipped', reason: 'multi-root' };
  if (!meta.uri.startsWith('file:')) {
    const remote = /^vscode-remote:|^vscode-vfs:|^ssh-remote|^wsl/.test(meta.uri);
    return { ...base, status: 'skipped', reason: remote ? 'remote' : 'unsupported-uri' };
  }
  let fsPath: string;
  try {
    fsPath = uriToFsPath(meta.uri, platform);
  } catch {
    return { ...base, status: 'skipped', reason: 'unsupported-uri' };
  }
  return { ...base, fsPath, status: fs.existsSync(fsPath) ? 'ok' : 'orphan' };
}

/** Read every slot under `workspaceStorage` (read-only). A missing folder yields []. */
export function scanStorage(storageDir: string, platform: NodeJS.Platform = process.platform): Slot[] {
  let ids: string[];
  try {
    ids = fs.readdirSync(storageDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  return ids.sort().map((id) => scanSlot(storageDir, id, platform));
}

// ---------------------------------------------------------------- ranking

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

function dice(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  if (x.length === 0 || y.length === 0) return 0;
  const pool = new Map<string, number>();
  for (const g of y) pool.set(g, (pool.get(g) ?? 0) + 1);
  let hit = 0;
  for (const g of x) {
    const n = pool.get(g) ?? 0;
    if (n > 0) {
      hit++;
      pool.set(g, n - 1);
    }
  }
  return (2 * hit) / (x.length + y.length);
}

/** 3 same name, 2 one name contains the other, 1 similar (Dice >= 0.5), 0 unrelated. */
export function nameScore(oldPath: string, currentPath: string): number {
  const a = normalizeName(path.basename(oldPath));
  const b = normalizeName(path.basename(currentPath));
  if (!a || !b) return 0;
  if (a === b) return 3;
  if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) return 2;
  return dice(a, b) >= 0.5 ? 1 : 0;
}

const EVIDENCE_FILE_LIMIT = 20;
const EVIDENCE_BYTES_LIMIT = 2 * 1024 * 1024;

/**
 * Count distinct files mentioned inside the old slot's sessions (as `<oldFolder>/<relative>`)
 * that also exist under the current folder. Strong proof that it is the same project.
 */
export function pathEvidence(slot: Slot, currentFolder: string): number {
  if (!slot.fsPath) return 0;
  const old = slot.fsPath.replace(/\\/g, '/');
  const escaped = old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}/([\\w.@\\-/]+)`, 'g');
  const found = new Set<string>();
  for (const s of slot.sessions.slice(0, EVIDENCE_FILE_LIMIT)) {
    let text: string;
    try {
      const stat = fs.statSync(s.file);
      if (stat.size > EVIDENCE_BYTES_LIMIT) continue;
      text = fs.readFileSync(s.file, 'utf8').replace(/\\\//g, '/');
    } catch {
      continue;
    }
    for (const m of text.matchAll(re)) {
      const rel = (m[1] as string).replace(/[.\-/]+$/, '');
      if (rel && fs.existsSync(path.join(currentFolder, rel))) found.add(rel);
    }
  }
  return found.size;
}

export interface Candidate {
  slot: Slot;
  nameScore: number;
  evidence: number;
  /** Sort key: name match dominates, path evidence breaks ties. */
  score: number;
}

/**
 * Rank orphaned slots (that still hold sessions) as candidates for `currentFolder`.
 * Only candidates with a name or evidence signal are `relevant`.
 */
export function rankCandidates(slots: Slot[], currentFolder: string): Candidate[] {
  const out: Candidate[] = [];
  for (const slot of slots) {
    if (slot.status !== 'orphan' || !slot.fsPath || slot.sessions.length === 0) continue;
    const ns = nameScore(slot.fsPath, currentFolder);
    const evidence = pathEvidence(slot, currentFolder);
    out.push({ slot, nameScore: ns, evidence, score: ns * 100 + Math.min(evidence, 50) });
  }
  return out.sort((a, b) => b.score - a.score || a.slot.id.localeCompare(b.slot.id));
}

export function isRelevant(c: Candidate): boolean {
  return c.nameScore > 0 || c.evidence > 0;
}

/** Find a slot by workspace.json folder path (exact, normalized). */
export function findSlotByPath(slots: Slot[], folder: string): Slot | undefined {
  const want = canon(folder);
  return slots.find((s) => s.fsPath !== undefined && canon(s.fsPath) === want);
}

/** Resolve symlinks when the path exists (so /tmp and /private/tmp compare equal); else just normalize. */
function canon(p: string): string {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync(abs);
  } catch {
    return abs;
  }
}
