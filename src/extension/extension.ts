import path from 'node:path';
import * as vscode from 'vscode';
import {
  resolveUserDataDir,
  userDataFromGlobalStorageUri,
  userDataFromStorageUri,
  workspaceStorageDir,
} from '../core/paths';
import { isRelevant, rankCandidates, scanStorage, type Candidate } from '../core/scan';
import { langFromLocale, translator, type Lang } from '../i18n/messages';
import { setCoreLang } from '../core/msg';
import {
  buildRelinkCommand,
  buildSessionItems,
  openAsImportedCopies,
  savePlan,
  type SessionItem,
} from './ui';

const DISMISSED_KEY = 'chatRelink.dismissed';

/** Setting `chatRelink.language`: auto follows the VS Code display language. */
export function resolveExtensionLang(setting: string | undefined, displayLanguage: string | undefined): Lang {
  if (setting === 'en' || setting === 'ko') return setting;
  return langFromLocale(displayLanguage);
}

function currentLang(): Lang {
  const setting = vscode.workspace.getConfiguration('chatRelink').get<string>('language', 'auto');
  const lang = resolveExtensionLang(setting, vscode.env.language);
  setCoreLang(lang); // core errors and warnings follow the same language
  return lang;
}

interface Where {
  userDataDir: string;
  storageDir: string;
  /** The folder open in this window, when it is a local one. */
  currentFolder: string | undefined;
}

function locate(context: vscode.ExtensionContext): Where {
  const fromStorage = context.storageUri ? userDataFromStorageUri(context.storageUri.fsPath) : undefined;
  const fromGlobal = userDataFromGlobalStorageUri(context.globalStorageUri.fsPath);
  const userDataDir = fromStorage ?? fromGlobal ?? resolveUserDataDir();
  const first = vscode.workspace.workspaceFolders?.[0]?.uri;
  return {
    userDataDir,
    storageDir: workspaceStorageDir(userDataDir),
    currentFolder: first && first.scheme === 'file' ? first.fsPath : undefined,
  };
}

/**
 * Called once after startup. Reads workspace.json files and session file names only
 * (replaying happens when the user asks for a preview).
 */
export async function runStartupScan(context: vscode.ExtensionContext): Promise<void> {
  if (!vscode.workspace.getConfiguration('chatRelink').get<boolean>('scanOnStartup', true)) return;
  const where = locate(context);
  if (!where.currentFolder) return;
  const dismissed = context.globalState.get<string[]>(DISMISSED_KEY, []);
  if (dismissed.includes(where.currentFolder)) return;

  const slots = scanStorage(where.storageDir);
  const relevant = rankCandidates(slots, where.currentFolder).filter(isRelevant);
  const top = relevant[0];
  if (!top) return;

  const m = translator(currentLang());
  const review = m('ext.review');
  const notNow = m('ext.notNow');
  const never = m('ext.never');
  const choice = await vscode.window.showInformationMessage(
    m('ext.found', { count: top.slot.sessions.length, name: path.basename(top.slot.fsPath ?? top.slot.id) }),
    review,
    notNow,
    never,
  );
  if (choice === never) {
    await context.globalState.update(DISMISSED_KEY, [...dismissed, where.currentFolder]);
  } else if (choice === review) {
    await reviewCandidates(context, where, relevant);
  }
}

/** Command `Chat Relink: Find Orphaned Chats`. */
export async function findOrphans(context: vscode.ExtensionContext): Promise<void> {
  const where = locate(context);
  const slots = scanStorage(where.storageDir);
  const ranked = where.currentFolder
    ? rankCandidates(slots, where.currentFolder)
    : rankCandidates(slots, path.join(where.userDataDir, '__no_current_folder__'));
  await reviewCandidates(context, where, ranked);
}

async function reviewCandidates(context: vscode.ExtensionContext, where: Where, candidates: Candidate[]): Promise<void> {
  const lang = currentLang();
  const m = translator(lang);
  const items = buildSessionItems(candidates, m);
  if (items.length === 0) {
    void vscode.window.showInformationMessage(m('ext.noOrphans'));
    return;
  }
  const picked = await vscode.window.showQuickPick(items, { canPickMany: true, placeHolder: m('ext.pickSessions') });
  if (!picked || picked.length === 0) return;

  const openChoice = { label: m('ext.action.open'), action: 'open' as const };
  const relinkChoice = { label: m('ext.action.relink'), action: 'relink' as const };
  const choices = where.currentFolder ? [openChoice, relinkChoice] : [openChoice];
  const action = await vscode.window.showQuickPick(choices, { placeHolder: m('ext.pickAction', { count: picked.length }) });
  if (!action) return;

  if (action.action === 'open') {
    const exportDir = path.join(context.globalStorageUri.fsPath, 'exports');
    const opened = await openAsImportedCopies(picked as SessionItem[], exportDir, m);
    if (opened > 0) void vscode.window.showInformationMessage(m('ext.opened', { count: opened }));
    return;
  }
  await saveRelinkPlans(where, picked as SessionItem[], lang);
}

async function saveRelinkPlans(where: Where, picked: SessionItem[], lang: Lang): Promise<void> {
  const m = translator(lang);
  const bySlot = new Map<string, SessionItem[]>();
  for (const it of picked) bySlot.set(it.slot.id, [...(bySlot.get(it.slot.id) ?? []), it]);
  const commands: string[] = [];
  let planFile = '';
  for (const [slotId, group] of bySlot) {
    const sessionIds = group.map((g) => g.session.sessionId);
    const command = buildRelinkCommand({
      slotId,
      toFolder: where.currentFolder as string,
      sessionIds,
      userDataDir: where.userDataDir,
      lang,
    });
    commands.push(command);
    planFile = savePlan({
      version: 1,
      createdAt: new Date().toISOString(),
      userDataDir: where.userDataDir,
      from: { id: slotId, folder: (group[0] as SessionItem).slot.fsPath ?? null },
      to: { folder: where.currentFolder as string },
      sessions: group.map((g) => ({ id: g.session.sessionId, title: g.title })),
      command,
    });
  }
  await vscode.env.clipboard.writeText(commands.join('\n'));
  void vscode.window.showInformationMessage(m('ext.planSaved', { path: planFile }));
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand('chatRelink.findOrphans', () => findOrphans(context)));
  // Do not delay activation: scan on the next tick, ignore failures (a notification is optional).
  setImmediate(() => {
    runStartupScan(context).catch(() => undefined);
  });
}

export function deactivate(): void {
  /* nothing to release: no timers, watchers or connections are kept */
}
