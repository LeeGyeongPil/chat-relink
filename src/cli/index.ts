#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { exportSessions } from '../core/exportJson';
import { formatDate, previewFile } from '../core/preview';
import {
  applyRelink,
  EXIT,
  planRelink,
  RelinkError,
  undoRelink,
  VerifyError,
  type RelinkPlan,
} from '../core/relink';
import {
  currentPathEnv,
  isProduct,
  resolveUserDataDir,
  toolHomeDir,
  workspaceStorageDir,
  type PathEnv,
} from '../core/paths';
import { findSlotByPath, isRelevant, rankCandidates, scanStorage, type Slot } from '../core/scan';
import { computeFolderId } from '../core/workspaceId';
import { isLang, resolveLang, translator, type Lang, type MessageKey } from '../i18n/messages';
import { setCoreLang } from '../core/msg';
import { runDemo } from './demo';

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

const VERSION = '0.1.0';


/** Look at `--lang` before full parsing so even usage errors come out in the right language. */
function peekLang(argv: string[], env: Record<string, string | undefined>): Lang {
  let flag: Lang | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const v = a === '--lang' ? argv[i + 1] : a.startsWith('--lang=') ? a.slice(7) : undefined;
    if (v !== undefined && isLang(v)) flag = v;
  }
  return resolveLang({ flag, env });
}

/** Absolute path with symlinks resolved (macOS /tmp is /private/tmp); plain resolve when it does not exist. */
function realPath(p: string): string {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync(abs);
  } catch {
    return abs;
  }
}

function resolveSlot(slots: Slot[], ref: string): { slot?: Slot; matches: Slot[] } {
  const exact = slots.filter((s) => s.id === ref);
  const byPrefix = ref.length >= 4 ? slots.filter((s) => s.id.startsWith(ref)) : [];
  const byPath = slots.filter((s) => s.fsPath !== undefined && path.resolve(s.fsPath) === path.resolve(ref));
  const byName = slots.filter((s) => s.fsPath !== undefined && path.basename(s.fsPath) === ref);
  for (const group of [exact, byPrefix, byPath, byName]) {
    if (group.length === 1) return { slot: group[0] as Slot, matches: group };
    if (group.length > 1) return { matches: group };
  }
  return { matches: [] };
}

function statusText(m: ReturnType<typeof translator>, s: Slot): string {
  const base = m(`status.${s.status}` as MessageKey);
  return s.reason ? `${base}: ${m(`reason.${s.reason}` as MessageKey)}` : base;
}

function table(rows: string[][]): string[] {
  const widths = rows.reduce<number[]>((w, r) => r.map((c, i) => Math.max(w[i] ?? 0, c.length)), []);
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i] ?? 0))).join('  '));
}

export async function run(argv: string[], io: Io, env: Record<string, string | undefined> = process.env): Promise<number> {
  const lang = peekLang(argv, env);
  const m = translator(lang);
  setCoreLang(lang);
  const pe: PathEnv = { ...currentPathEnv(), env };
  const json = (value: unknown): void => io.out(JSON.stringify(value, null, 2));

  let parsed: ReturnType<typeof parse>;
  function parse() {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        lang: { type: 'string' },
        'user-data-dir': { type: 'string' },
        product: { type: 'string' },
        current: { type: 'string' },
        json: { type: 'boolean' },
        from: { type: 'string' },
        to: { type: 'string' },
        sessions: { type: 'string' },
        apply: { type: 'boolean' },
        out: { type: 'string' },
        keep: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  }
  const usage = (detail: string): number => {
    io.err(m('error.usage', { detail }));
    return EXIT.usage;
  };

  try {
    parsed = parse();
  } catch (e) {
    return usage((e as Error).message);
  }
  const { values, positionals } = parsed;
  if (values.lang !== undefined && !isLang(values.lang)) return usage(m('error.badLang', { lang: values.lang }));
  if (values.help) {
    io.out(m('help.text'));
    return EXIT.ok;
  }
  if (values.version) {
    io.out(VERSION);
    return EXIT.ok;
  }
  const command = positionals[0];
  if (!command) return usage(m('error.missingCommand'));
  if (values.product !== undefined && !isProduct(values.product)) {
    return usage(m('error.badProduct', { product: values.product }));
  }

  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  const minor = Number.parseInt(process.versions.node.split('.')[1] ?? '0', 10);
  if (major < 22 || (major === 22 && minor < 13)) {
    io.err(m('error.failure', { message: m('error.nodeVersion', { version: process.versions.node }) }));
    return EXIT.failure;
  }

  const userDataDir = resolveUserDataDir(
    { userDataDir: values['user-data-dir'], product: values.product as never },
    pe,
  );
  const storageDir = workspaceStorageDir(userDataDir);
  const needStorage = (): boolean => {
    if (fs.existsSync(storageDir)) return true;
    io.err(m('error.failure', { message: m('error.storageMissing', { dir: storageDir }) }));
    return false;
  };
  const lookup = (slots: Slot[], ref: string): Slot | undefined => {
    const { slot, matches } = resolveSlot(slots, ref);
    if (slot) return slot;
    if (matches.length > 1) {
      io.err(m('error.failure', { message: m('error.slotAmbiguous', { ref, count: matches.length, list: matches.map((s) => s.id.slice(0, 8)).join(', ') }) }));
    } else {
      io.err(m('error.failure', { message: m('error.slotNotFound', { ref }) }));
    }
    return undefined;
  };
  const sqliteQuiet = (): void => {
    // node:sqlite may print an ExperimentalWarning on some Node versions; keep other warnings.
    process.removeAllListeners('warning');
    process.on('warning', (w) => {
      if (!/sqlite/i.test(w.message)) process.stderr.write(`${w.name}: ${w.message}\n`);
    });
  };

  try {
    switch (command) {
      case 'scan': {
        if (!needStorage()) return EXIT.failure;
        const slots = scanStorage(storageDir);
        const current = path.resolve(values.current ?? process.cwd());
        const ranked = rankCandidates(slots, current).filter(isRelevant);
        const counts = {
          orphans: slots.filter((s) => s.status === 'orphan' && s.sessions.length > 0).length,
          skipped: slots.filter((s) => s.status === 'skipped').length,
          ok: slots.filter((s) => s.status === 'ok').length,
        };
        if (values.json) {
          json({
            userDataDir,
            slots: slots.map((s) => ({ id: s.id, folder: s.fsPath ?? s.uri ?? null, status: s.status, reason: s.reason ?? null, sessions: s.sessions.length })),
            candidates: ranked.map((c) => ({ id: c.slot.id, nameScore: c.nameScore, evidence: c.evidence })),
            ...counts,
          });
          return EXIT.ok;
        }
        io.out(m('scan.header', { dir: storageDir }));
        if (slots.length === 0) {
          io.out(m('scan.none'));
          return EXIT.ok;
        }
        const header = m('scan.columns').trim().split(/\s{2,}/);
        const body = slots.map((s) => [s.id.slice(0, 8), statusText(m, s), String(s.sessions.length), s.fsPath ?? s.uri ?? '-']);
        for (const line of table([header, ...body])) {
          io.out(line);
        }
        io.out(m('scan.summary', counts));
        if (values.current !== undefined || ranked.length > 0) {
          if (ranked.length > 0) {
            io.out(m('scan.candidates', { folder: current }));
            for (const c of ranked) {
              io.out(m('scan.candidate', { id: c.slot.id.slice(0, 8), name: path.basename(c.slot.fsPath ?? c.slot.id), sessions: c.slot.sessions.length, nameScore: c.nameScore, evidence: c.evidence }));
            }
          } else {
            io.out(m('scan.noCandidates', { folder: current }));
          }
        }
        if (counts.orphans > 0) io.out(m('scan.next'));
        return EXIT.ok;
      }

      case 'show': {
        const ref = positionals[1];
        if (!ref) return usage(m('error.missingArgument', { command: 'show', what: '<slot|path>' }));
        if (!needStorage()) return EXIT.failure;
        const slot = lookup(scanStorage(storageDir), ref);
        if (!slot) return EXIT.failure;
        const previews = slot.sessions.map((s) => ({ s, p: previewFile(s.file) }));
        if (values.json) {
          json({ id: slot.id, folder: slot.fsPath ?? slot.uri ?? null, status: slot.status, sessions: previews.map(({ s, p }) => ({ ...p, hasJsonTwin: s.hasJsonTwin, lastDate: p.lastDate ?? null })) });
          return EXIT.ok;
        }
        io.out(m('show.header', { id: slot.id.slice(0, 8), folder: slot.fsPath ?? slot.uri ?? '-' }));
        if (previews.length === 0) {
          io.out(m('show.empty'));
          return EXIT.ok;
        }
        io.out(m('show.columns'));
        for (const { s, p } of previews) {
          io.out(`${p.sessionId.slice(0, 8)}   ${String(p.turns).padEnd(5)}  ${formatDate(p.lastDate)}  ${p.format.padEnd(6)}  ${p.title}`);
          if (s.hasJsonTwin) io.out(m('show.twin'));
          if (p.error) io.out(m('show.error', { text: p.error }));
          for (const w of p.warnings) io.out(m('show.warning', { text: w }));
        }
        return EXIT.ok;
      }

      case 'relink': {
        if (!values.from) return usage(m('error.missingOption', { name: 'from' }));
        if (!values.to) return usage(m('error.missingOption', { name: 'to' }));
        if (!needStorage()) return EXIT.failure;
        sqliteQuiet();
        const slots = scanStorage(storageDir);
        const from = lookup(slots, values.from);
        if (!from) return EXIT.usage;
        const folder = realPath(values.to);
        let to = findSlotByPath(slots, folder);
        if (!to && fs.existsSync(folder)) {
          const id = computeFolderId(folder, pe.platform, fs.statSync(folder));
          to = slots.find((s) => s.id === id);
        }
        if (!to) {
          io.err(m('error.failure', { message: m('error.targetNotFound', { folder }) }));
          return EXIT.noTarget;
        }
        const sessionIds = values.sessions ? values.sessions.split(',').map((x) => x.trim()).filter(Boolean) : undefined;
        const plan = planRelink({ from, to, ...(sessionIds ? { sessionIds } : {}) });
        if (!values.apply) {
          if (values.json) json({ mode: 'dry-run', plan: summarizePlan(plan) });
          else printPlan(io, m, plan, from, to);
          if (!values.json) io.out(m('relink.dryRun'));
          return EXIT.ok;
        }
        if (!values.json) printPlan(io, m, plan, from, to);
        if (!plan.items.some((i) => i.action === 'copy')) {
          io.out(m('relink.nothingToCopy'));
          return EXIT.ok;
        }
        const result = applyRelink(plan, { userDataDir, toolHome: toolHomeDir(pe) });
        if (values.json) {
          json({ mode: 'applied', ...result });
          return EXIT.ok;
        }
        for (const w of result.warnings) io.out(m('relink.warningRunning', { text: w }));
        io.out(m('relink.applied', { count: result.copied.length }));
        io.out(m('relink.backup', { path: result.backup }));
        io.out(m('relink.integrity', { result: result.integrity }));
        io.out(m('relink.journal', { path: result.journal }));
        io.out(m('relink.undoHint', { path: result.journal }));
        return EXIT.ok;
      }

      case 'undo': {
        const journal = positionals[1];
        if (!journal) return usage(m('error.missingArgument', { command: 'undo', what: '<journal>' }));
        sqliteQuiet();
        const res = undoRelink(path.resolve(journal));
        if (values.json) {
          json(res);
          return EXIT.ok;
        }
        io.out(m('undo.done', { mode: m(`undo.mode.${res.mode}` as MessageKey), files: res.removedFiles, entries: res.removedEntries }));
        io.out(m(res.confirmed ? 'undo.confirmed' : 'undo.notConfirmed'));
        return res.confirmed ? EXIT.ok : EXIT.failure;
      }

      case 'export': {
        if (!values.from) return usage(m('error.missingOption', { name: 'from' }));
        if (!values.out) return usage(m('error.missingOption', { name: 'out' }));
        if (!needStorage()) return EXIT.failure;
        const slot = lookup(scanStorage(storageDir), values.from);
        if (!slot) return EXIT.failure;
        const outDir = path.resolve(values.out);
        const written = exportSessions(slot.sessions.map((s) => s.file), outDir);
        io.err(m('export.warning'));
        if (values.json) {
          json({ outDir, files: written });
          return EXIT.ok;
        }
        io.out(m('export.wrote', { count: written.length, dir: outDir }));
        for (const w of written) io.out(m('export.line', { file: w.file, requests: w.requests }));
        io.out(m('export.import'));
        return EXIT.ok;
      }

      case 'demo': {
        sqliteQuiet();
        runDemo({ out: io.out }, lang, { keep: values.keep === true });
        return EXIT.ok;
      }

      default:
        return usage(m('error.unknownCommand', { command }));
    }
  } catch (e) {
    if (e instanceof VerifyError) {
      io.err(m('relink.verifyFailed', { detail: e.failures.join('; ') }));
      return e.code;
    }
    if (e instanceof RelinkError) {
      io.err(m('error.failure', { message: e.i18n ? m(e.i18n.key, e.i18n.params) : e.message }));
      return e.code;
    }
    io.err(m('error.failure', { message: (e as Error).message }));
    return EXIT.failure;
  }
}

function summarizePlan(plan: RelinkPlan): unknown {
  return {
    from: plan.from.id,
    to: plan.to.id,
    indexCountBefore: plan.indexCountBefore,
    indexCountAfter: plan.indexCountAfter,
    warnings: plan.warnings,
    items: plan.items.map((i) => ({ sessionId: i.sessionId, action: i.action, reason: i.reason ?? null, title: i.title, turns: i.turns })),
  };
}

function printPlan(io: Io, m: ReturnType<typeof translator>, plan: RelinkPlan, from: Slot, to: Slot): void {
  io.out(m('relink.planHeader', { from: from.fsPath ?? from.id.slice(0, 8), to: to.fsPath ?? to.id.slice(0, 8) }));
  for (const i of plan.items) {
    io.out(m('relink.item', { action: m(`relink.action.${i.action}` as MessageKey), id: i.sessionId.slice(0, 8), turns: i.turns, title: i.title }));
    if (i.reason) io.out(m('relink.itemReason', { reason: m(`relink.reason.${i.reason}` as MessageKey) }));
  }
  io.out(m('relink.indexCount', { before: plan.indexCountBefore, after: plan.indexCountAfter }));
  for (const w of plan.warnings) io.out(m('relink.warningRunning', { text: w }));
}


if (require.main === module) {
  // `chat-relink scan | head` closes the pipe early; that is not an error.
  process.stdout.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code !== 'EPIPE') throw e;
  });
  run(process.argv.slice(2), {
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      process.stderr.write(`${(e as Error).message}\n`);
      process.exitCode = EXIT.failure;
    },
  );
}
