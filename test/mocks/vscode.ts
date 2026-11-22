/**
 * Minimal stand-in for the `vscode` module, wired in through the vitest alias.
 * Tests script the user's answers through `mock` and read back what the extension did.
 */
type Answer<T> = T | ((arg: unknown) => T);

interface InfoCall {
  message: string;
  buttons: string[];
}

export const mock = {
  language: 'en',
  config: {} as Record<string, unknown>,
  folders: [] as string[],
  clipboard: '',
  infoCalls: [] as InfoCall[],
  errorCalls: [] as string[],
  executed: [] as Array<{ command: string; args: unknown[] }>,
  quickPickCalls: [] as Array<{ items: unknown[]; options: unknown }>,
  registered: new Map<string, (...args: unknown[]) => unknown>(),
  /** Answers for showInformationMessage, consumed in order (undefined = dismissed). */
  infoAnswers: [] as Array<Answer<string | undefined>>,
  /** Answers for showQuickPick, consumed in order; may be a function of the items. */
  pickAnswers: [] as Array<Answer<unknown>>,
  reset(): void {
    this.language = 'en';
    this.config = {};
    this.folders = [];
    this.clipboard = '';
    this.infoCalls = [];
    this.errorCalls = [];
    this.executed = [];
    this.quickPickCalls = [];
    this.registered = new Map();
    this.infoAnswers = [];
    this.pickAnswers = [];
  },
};

function resolveAnswer<T>(a: Answer<T> | undefined, arg: unknown): T | undefined {
  return typeof a === 'function' ? (a as (x: unknown) => T)(arg) : a;
}

export const Uri = {
  file(fsPath: string) {
    return { scheme: 'file', fsPath, toString: () => `file://${fsPath}` };
  },
};

export const window = {
  async showInformationMessage(message: string, ...buttons: string[]): Promise<string | undefined> {
    mock.infoCalls.push({ message, buttons });
    return resolveAnswer(mock.infoAnswers.shift(), buttons);
  },
  async showErrorMessage(message: string): Promise<undefined> {
    mock.errorCalls.push(message);
    return undefined;
  },
  async showQuickPick(items: unknown[], options: unknown): Promise<unknown> {
    mock.quickPickCalls.push({ items, options });
    return resolveAnswer(mock.pickAnswers.shift(), items);
  },
};

export const commands = {
  registerCommand(command: string, fn: (...args: unknown[]) => unknown) {
    mock.registered.set(command, fn);
    return { dispose: () => mock.registered.delete(command) };
  },
  async executeCommand(command: string, ...args: unknown[]): Promise<undefined> {
    mock.executed.push({ command, args });
    return undefined;
  },
};

export const env = {
  get language(): string {
    return mock.language;
  },
  clipboard: {
    async writeText(text: string): Promise<void> {
      mock.clipboard = text;
    },
  },
};

export const workspace = {
  get workspaceFolders() {
    return mock.folders.length ? mock.folders.map((f) => ({ uri: Uri.file(f) })) : undefined;
  },
  getConfiguration(section: string) {
    return {
      get<T>(key: string, fallback?: T): T | undefined {
        const v = mock.config[`${section}.${key}`];
        return (v === undefined ? fallback : v) as T | undefined;
      },
    };
  },
};
