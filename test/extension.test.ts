import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { activate, findOrphans, resolveExtensionLang, runStartupScan } from '../src/extension/extension';
import { hashTree } from '../src/core/relink';
import { FIXTURE_SESSION_IDS } from '../src/core/fixture';
import { mock } from './mocks/vscode';
import { makeFixture } from './helpers';

function makeContext(fx: ReturnType<typeof makeFixture>) {
  const store = new Map<string, unknown>();
  return {
    subscriptions: [] as Array<{ dispose(): void }>,
    storageUri: { fsPath: path.join(fx.storageDir, fx.currentId, 'publisher.chat-relink') },
    globalStorageUri: { fsPath: path.join(fx.userDataDir, 'User', 'globalStorage', 'publisher.chat-relink') },
    globalState: {
      get: <T>(key: string, fallback: T): T => (store.has(key) ? (store.get(key) as T) : fallback),
      update: async (key: string, value: unknown) => {
        store.set(key, value);
      },
    },
  } as never;
}

/** The tool home is redirected so the "plan" file never lands in the real home folder. */
function withToolHome(dir: string): void {
  process.env.CHAT_RELINK_HOME = dir;
}

describe('extension flow with a vscode mock (AC-8)', () => {
  beforeEach(() => {
    mock.reset();
  });

  it('notifies once with the session count and offers Review / Not now / Never', async () => {
    const fx = makeFixture();
    mock.folders = [fx.currentFolder];
    mock.infoAnswers = ['Not now'];
    await runStartupScan(makeContext(fx));
    expect(mock.infoCalls).toHaveLength(1);
    expect(mock.infoCalls[0]!.message).toBe("Found 2 chat(s) from a previous folder 'shop-api'.");
    expect(mock.infoCalls[0]!.buttons).toEqual(['Review', 'Not now', 'Never for this folder']);
  });

  it('stays silent after "Never for this folder"', async () => {
    const fx = makeFixture();
    mock.folders = [fx.currentFolder];
    const ctx = makeContext(fx);
    mock.infoAnswers = ['Never for this folder'];
    await runStartupScan(ctx);
    expect(mock.infoCalls).toHaveLength(1);
    await runStartupScan(ctx);
    expect(mock.infoCalls).toHaveLength(1);
  });

  it('does nothing when no folder is open or the setting is off', async () => {
    const fx = makeFixture();
    await runStartupScan(makeContext(fx));
    mock.folders = [fx.currentFolder];
    mock.config['chatRelink.scanOnStartup'] = false;
    await runStartupScan(makeContext(fx));
    expect(mock.infoCalls).toHaveLength(0);
  });

  it('QuickPick detail has turn count and date; picking opens each session through the import command', async () => {
    const fx = makeFixture();
    mock.folders = [fx.currentFolder];
    const ctx = makeContext(fx);
    const before = hashTree(fx.storageDir);
    mock.infoAnswers = ['Review'];
    mock.pickAnswers = [
      (items: unknown) => items, // select every session
      (choices: unknown) => (choices as Array<{ action: string }>).find((c) => c.action === 'open'),
    ];
    await runStartupScan(ctx);

    const rows = mock.quickPickCalls[0]!.items as Array<{ label: string; detail: string }>;
    expect(rows.map((r) => r.label).sort()).toEqual(['Fix login bug', 'Refactor cart']);
    expect(rows.find((r) => r.label === 'Fix login bug')!.detail).toBe('3 turn(s) | 2026-10-01');

    const imports = mock.executed.filter((e) => e.command === 'workbench.action.chat.import');
    expect(imports).toHaveLength(2);
    const arg = imports[0]!.args[0] as { inputPath: { fsPath: string }; target: string };
    expect(arg.target).toBe('chatViewPane');
    expect(arg.inputPath.fsPath.startsWith(path.join(fx.userDataDir, 'User', 'globalStorage'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(arg.inputPath.fsPath, 'utf8')).requests.length).toBeGreaterThan(0);
    expect(mock.infoCalls.at(-1)!.message).toMatch(/Opened 2 imported cop/);

    // the extension wrote nothing into workspaceStorage (state.vscdb and chatSessions untouched)
    expect(hashTree(fx.storageDir)).toBe(before);
  });

  it('"Relink permanently" saves a plan file and copies the CLI command', async () => {
    const fx = makeFixture();
    withToolHome(path.join(fx.root, 'tool-home'));
    mock.folders = [fx.currentFolder];
    const before = hashTree(fx.storageDir);
    mock.pickAnswers = [
      (items: unknown) => (items as Array<{ label: string }>).filter((i) => i.label === 'Fix login bug'),
      (choices: unknown) => (choices as Array<{ action: string }>).find((c) => c.action === 'relink'),
    ];
    await findOrphans(makeContext(fx));
    delete process.env.CHAT_RELINK_HOME;

    expect(mock.clipboard).toContain('npx chat-relink relink');
    expect(mock.clipboard).toContain(`--from ${fx.oldId}`);
    expect(mock.clipboard).toContain(`--sessions ${FIXTURE_SESSION_IDS.loginBug}`);
    expect(mock.clipboard).toContain('--apply');
    const plans = fs.readdirSync(path.join(fx.root, 'tool-home', 'plans'));
    expect(plans).toHaveLength(1);
    const plan = JSON.parse(fs.readFileSync(path.join(fx.root, 'tool-home', 'plans', plans[0]!), 'utf8'));
    expect(plan.sessions).toEqual([{ id: FIXTURE_SESSION_IDS.loginBug, title: 'Fix login bug' }]);
    expect(mock.infoCalls.at(-1)!.message).toMatch(/Quit VS Code completely/);
    expect(mock.executed).toHaveLength(0);
    expect(hashTree(fx.storageDir)).toBe(before);
  });

  it('registers the command and reports when there is nothing to find', async () => {
    const fx = makeFixture();
    fs.rmSync(path.join(fx.storageDir, fx.oldId), { recursive: true });
    fs.rmSync(path.join(fx.storageDir, fx.scratchId!), { recursive: true });
    const ctx = makeContext(fx);
    activate(ctx);
    expect(mock.registered.has('chatRelink.findOrphans')).toBe(true);
    await mock.registered.get('chatRelink.findOrphans')!();
    expect(mock.infoCalls.at(-1)!.message).toBe('No orphaned chats were found.');
  });

  it('the language setting changes the notification text', async () => {
    const fx = makeFixture();
    mock.folders = [fx.currentFolder];
    mock.config['chatRelink.language'] = 'ko';
    mock.infoAnswers = [undefined];
    await runStartupScan(makeContext(fx));
    expect(mock.infoCalls[0]!.message).toBe("이전 폴더 'shop-api' 의 채팅 2개를 찾았습니다.");
    expect(mock.infoCalls[0]!.buttons[0]).toBe('확인');
  });

  it('auto follows the VS Code display language', () => {
    expect(resolveExtensionLang('auto', 'ko')).toBe('ko');
    expect(resolveExtensionLang('auto', 'de')).toBe('en');
    expect(resolveExtensionLang(undefined, 'ko-KR')).toBe('ko');
    expect(resolveExtensionLang('en', 'ko')).toBe('en');
  });
});
