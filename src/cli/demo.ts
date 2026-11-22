import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildFixture, writeLock } from '../core/fixture';
import { formatDate, previewFile } from '../core/preview';
import { applyRelink, planRelink, RelinkError, undoRelink } from '../core/relink';
import { checkRunning, simulateRunningFlush } from '../core/runningGuard';
import { findSlotByPath, rankCandidates, scanStorage } from '../core/scan';
import { openDb, readIndex } from '../core/stateDb';
import type { Lang } from '../i18n/messages';
import { translator } from '../i18n/messages';

export interface DemoIo {
  out: (line: string) => void;
}

export interface DemoSummary {
  orphans: number;
  relinked: number;
  integrity: string;
  externalLostAfterFlush: boolean;
  undo: string;
  guardExit: number;
  dir: string;
}

/**
 * Walk through the whole flow on a synthetic fixture. Every step runs the real core code against
 * real files and a real SQLite database; only the data is made up. The lines starting with a
 * key (`orphans:`, `relinked:` ...) are stable English so they can be checked by scripts.
 */
export function runDemo(io: DemoIo, lang: Lang, opts: { keep?: boolean } = {}): DemoSummary {
  const m = translator(lang);
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'chat-relink-demo-'));
  const toolHome = path.join(root, 'tool-home');
  try {
    io.out(m('demo.banner'));
    io.out('');

    // 1. fixture + rename
    io.out(`[1/8] ${m('demo.step1')}`);
    const fx = buildFixture({ root, includeSkipped: true });
    io.out(m('demo.step1.detail', {
      from: path.basename(fx.oldFolder),
      to: path.basename(fx.currentFolder),
      oldId: fx.oldId.slice(0, 8),
      newId: fx.currentId.slice(0, 8),
    }));

    // 2. scan
    io.out(`[2/8] ${m('demo.step2')}`);
    const slots = scanStorage(fx.storageDir);
    const orphans = slots.filter((s) => s.status === 'orphan' && s.sessions.length > 0);
    const skipped = slots.filter((s) => s.status === 'skipped');
    const ranked = rankCandidates(slots, fx.currentFolder);
    io.out(`  orphans: ${orphans.length}`);
    io.out(`  skipped: ${skipped.length}`);
    const from = ranked[0]?.slot;
    const to = findSlotByPath(slots, fx.currentFolder);
    if (!from || !to) throw new RelinkError('demo fixture is inconsistent', 1);

    // 3. preview
    io.out(`[3/8] ${m('demo.step3')}`);
    for (const s of from.sessions) {
      const pv = previewFile(s.file);
      io.out(`  - ${pv.title} | ${pv.turns} | ${formatDate(pv.lastDate)} | ${pv.format}`);
    }

    // 4. dry run
    io.out(`[4/8] ${m('demo.step4')}`);
    const plan = planRelink({ from, to });
    const treeBefore = fs.readdirSync(path.join(to.dir, 'chatSessions')).length;
    io.out(`  plan: copy ${plan.items.filter((i) => i.action === 'copy').length}, skip ${plan.items.filter((i) => i.action === 'skip').length}`);

    // 5. running guard
    io.out(`[5/8] ${m('demo.step5')}`);
    const lock = writeLock(fx.userDataDir, process.pid);
    let guardExit = 0;
    try {
      applyRelink(plan, { userDataDir: fx.userDataDir, toolHome });
    } catch (e) {
      if (e instanceof RelinkError) guardExit = e.code;
    }
    io.out(m('demo.step5.detail'));
    io.out(`  running guard: ${checkRunning(fx.userDataDir).state}, exit ${guardExit}`);
    fs.rmSync(lock);

    // 6. real apply
    io.out(`[6/8] ${m('demo.step6')}`);
    const result = applyRelink(plan, { userDataDir: fx.userDataDir, toolHome });
    io.out(`  relinked: ${result.copied.length}`);
    io.out(`  integrity: ${result.integrity}`);

    // 7. the cache race, on a throwaway copy of the target database
    io.out(`[7/8] ${m('demo.step7')}`);
    const raceCopy = path.join(root, 'race.vscdb');
    fs.copyFileSync(path.join(to.dir, 'state.vscdb'), raceCopy);
    const race = simulateRunningFlush(raceCopy);
    io.out(m('demo.step7.detail'));
    io.out(`  external entry lost after flush: ${race.externalLostAfterFlush}`);

    // 8. undo
    io.out(`[8/8] ${m('demo.step8')}`);
    const undo = undoRelink(result.journal);
    const db = openDb(path.join(to.dir, 'state.vscdb'), { readOnly: true });
    const indexAfter = Object.keys(readIndex(db).entries).length;
    db.close();
    const restored = undo.confirmed && indexAfter === 0 && fs.readdirSync(path.join(to.dir, 'chatSessions')).length === treeBefore;
    const undoLabel = restored ? 'restored' : 'incomplete';
    io.out(`  undo: ${undoLabel}`);

    return {
      orphans: orphans.length,
      relinked: result.copied.length,
      integrity: result.integrity,
      externalLostAfterFlush: race.externalLostAfterFlush,
      undo: undoLabel,
      guardExit,
      dir: root,
    };
  } finally {
    if (opts.keep) {
      io.out(m('demo.kept', { dir: root }));
    } else {
      fs.rmSync(root, { recursive: true, force: true });
      io.out(m('demo.cleanup'));
    }
  }
}
