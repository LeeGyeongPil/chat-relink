import fs from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { isExportableSessionData, toExportJson } from '../core/exportJson';
import { toolHomeDir } from '../core/paths';
import { formatDate, previewFile } from '../core/preview';
import type { Candidate, SessionFile, Slot } from '../core/scan';
import { readSessionFile } from '../core/sessionLog';
import { translator, type Lang } from '../i18n/messages';

export interface SessionItem extends vscode.QuickPickItem {
  slot: Slot;
  session: SessionFile;
  title: string;
}

type Translate = ReturnType<typeof translator>;

/** One QuickPick row per session; `detail` carries turn count and last date. */
export function buildSessionItems(candidates: Candidate[], m: Translate): SessionItem[] {
  const items: SessionItem[] = [];
  for (const c of candidates) {
    for (const session of c.slot.sessions) {
      const pv = previewFile(session.file);
      items.push({
        label: pv.title,
        description: path.basename(c.slot.fsPath ?? c.slot.id),
        detail: m('ext.itemDetail', { turns: pv.turns, date: formatDate(pv.lastDate) }),
        slot: c.slot,
        session,
        title: pv.title,
      });
    }
  }
  return items;
}

/**
 * Open sessions through the official import command. VS Code stores the result itself, so this path
 * never writes to a state database or a chatSessions folder. The temporary export files live in
 * this extension's own global storage.
 */
export async function openAsImportedCopies(
  items: SessionItem[],
  exportDir: string,
  m: Translate,
): Promise<number> {
  fs.mkdirSync(exportDir, { recursive: true });
  let opened = 0;
  for (const item of items) {
    try {
      const exported = toExportJson(readSessionFile(item.session.file).state);
      if (!isExportableSessionData(exported)) throw new Error('not exportable');
      const file = path.join(exportDir, `${item.session.sessionId}.json`);
      fs.writeFileSync(file, JSON.stringify(exported), { mode: 0o600 });
      await vscode.commands.executeCommand('workbench.action.chat.import', {
        inputPath: vscode.Uri.file(file),
        target: 'chatViewPane',
      });
      opened++;
    } catch (e) {
      void vscode.window.showErrorMessage(m('ext.importFailed', { title: item.title, error: (e as Error).message }));
    }
  }
  return opened;
}

export function shellQuote(value: string): string {
  if (/^[\w@%+=:,./-]+$/.test(value)) return value;
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}

export interface RelinkPlanFile {
  version: 1;
  createdAt: string;
  userDataDir: string;
  from: { id: string; folder: string | null };
  to: { folder: string };
  sessions: Array<{ id: string; title: string }>;
  command: string;
}

/** The CLI command that performs the permanent relink once VS Code is closed. */
export function buildRelinkCommand(args: {
  slotId: string;
  toFolder: string;
  sessionIds: string[];
  userDataDir: string;
  lang: Lang;
}): string {
  const parts = [
    'npx chat-relink relink',
    `--from ${args.slotId}`,
    `--to ${shellQuote(args.toFolder)}`,
    `--sessions ${args.sessionIds.join(',')}`,
    `--user-data-dir ${shellQuote(args.userDataDir)}`,
    `--lang ${args.lang}`,
    '--apply',
  ];
  return parts.join(' ');
}

/** Save the plan next to chat-relink's own journals (never inside VS Code's storage). */
export function savePlan(plan: RelinkPlanFile, home = toolHomeDir()): string {
  const dir = path.join(home, 'plans');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = plan.createdAt.replace(/[-:.]/g, '').replace('Z', '');
  const file = path.join(dir, `${stamp}-${plan.from.id.slice(0, 8)}.json`);
  fs.writeFileSync(file, JSON.stringify(plan, null, 2), { mode: 0o600 });
  return file;
}
