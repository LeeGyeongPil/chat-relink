import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Offline checks of the files CI depends on. They catch, on any machine, the kinds of
// mistakes that otherwise only show up on the remote runner: a workflow that drifted,
// a lock file out of sync with package.json, an install script that runs on Linux,
// a missing Linux binary, or a test that reads the host (platform, PID, network).

const root = path.resolve(__dirname, '..');
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8');

interface LockEntry {
  version?: string;
  resolved?: string;
  integrity?: string;
  hasInstallScript?: boolean;
  os?: string[];
  devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
}
const pkg = JSON.parse(read('package.json')) as {
  version: string;
  devDependencies: Record<string, string>;
  dependencies?: Record<string, string>;
  engines: Record<string, string>;
};
const lock = JSON.parse(read('package-lock.json')) as { version: string; packages: Record<string, LockEntry> };
const installed = Object.entries(lock.packages).filter(([key]) => key !== '');

describe('repo hygiene, offline (AC-9)', () => {
  it('(1) ci.yml is one Ubuntu 24.04 job on Node 24: npm ci, typecheck, test', () => {
    const ci = read('.github/workflows/ci.yml');
    const lines = ci.split('\n');
    // job ids are the keys indented by two spaces under `jobs:`
    const jobsAt = lines.indexOf('jobs:');
    expect(jobsAt).toBeGreaterThan(-1);
    const jobIds = lines.slice(jobsAt + 1).filter((l) => /^ {2}[\w-]+:\s*$/.test(l));
    expect(jobIds).toHaveLength(1);

    expect(ci).toMatch(/^\s+runs-on: ubuntu-24\.04\s*$/m);
    const uses = [...ci.matchAll(/^\s+- uses: (\S+)\s*$/gm)].map((m) => m[1]);
    expect(uses).toEqual(['actions/checkout@v6', 'actions/setup-node@v6']);
    expect(ci).toMatch(/^\s+node-version: "24"\s*$/m);
    const runs = [...ci.matchAll(/^\s+(?:- )?run: (.+?)\s*$/gm)].map((m) => m[1]);
    expect(runs).toEqual(['npm ci', 'npm run typecheck', 'npm test']);

    for (const banned of ['matrix', 'schedule', 'vsce', 'cache: npm', 'npm start']) {
      expect(ci, banned).not.toContain(banned);
    }
    expect(ci).not.toContain('\t'); // YAML forbids tabs for indentation
    expect(ci).not.toContain('\r');
  });

  it('(2) devDependencies are exact, without @vscode/vsce, and equal the lock root', () => {
    expect(Object.keys(pkg.devDependencies).sort()).toEqual(['@types/node', '@types/vscode', 'typescript', 'vitest']);
    for (const [name, version] of Object.entries(pkg.devDependencies)) {
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(pkg.dependencies ?? {}).toEqual({}); // no runtime dependencies at all
    const rootEntry = lock.packages[''] as LockEntry;
    expect(rootEntry.devDependencies).toEqual(pkg.devDependencies);
    expect(rootEntry.engines).toEqual(pkg.engines);
    expect(lock.version).toBe(pkg.version);
    // the version installed in the lock is the pinned one
    for (const [name, version] of Object.entries(pkg.devDependencies)) {
      expect(lock.packages[`node_modules/${name}`]?.version, name).toBe(version);
    }
    expect(Object.keys(lock.packages).some((k) => k.includes('@vscode/vsce'))).toBe(false);
  });

  it('(3) every locked package has a version, a registry.npmjs.org URL and an integrity hash', () => {
    expect(installed.length).toBeGreaterThan(0);
    const broken = installed.filter(
      ([, e]) => !e.version || !e.resolved?.startsWith('https://registry.npmjs.org/') || !e.integrity?.startsWith('sha512-'),
    );
    expect(broken.map(([k]) => k)).toEqual([]);
  });

  it('(4) no install script runs on Linux (only OS-restricted packages such as fsevents have one)', () => {
    const withScripts = installed.filter(([, e]) => e.hasInstallScript);
    for (const [key, e] of withScripts) {
      expect(e.os, key).toBeDefined();
      expect(e.os!.some((o) => o === 'linux' || o === '!darwin' || o === '!win32'), key).toBe(false);
      expect(e.os!.every((o) => !o.startsWith('!')), key).toBe(true);
    }
    expect(withScripts.map(([k]) => k)).toEqual(['node_modules/fsevents']);
  });

  it('(5) the lock keeps the Linux x64 native binaries the CI runner needs', () => {
    for (const name of ['@typescript/typescript-linux-x64', '@rolldown/binding-linux-x64-gnu']) {
      const entry = lock.packages[`node_modules/${name}`];
      expect(entry, name).toBeDefined();
      expect(entry!.os, name).toEqual(['linux']);
    }
  });

  it('(6) tests do not read the host: no platform override, own PID, child processes or network', () => {
    const self = path.basename(__filename);
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|mts|js|mjs|cjs)$/.test(name) && name !== self) files.push(full);
      }
    };
    walk(path.join(root, 'test'));
    expect(files.length).toBeGreaterThan(5);
    // patterns are built from pieces so this file does not match itself
    const banned: Array<[string, RegExp]> = [
      ['process.platform', new RegExp('process' + '\\.platform')],
      ['defineProperty(process', new RegExp('defineProperty\\(\\s*process' + '\\b')],
      ['process.pid', new RegExp('process' + '\\.pid\\b')],
      ['process.kill', new RegExp('process' + '\\.kill\\b')],
      ['child_process', new RegExp('child' + '_process')],
      ['fetch(', new RegExp('\\bfetch' + '\\(')],
      ['node:http(s)', new RegExp("['\"](node:)?https?" + "['\"]")],
      ['http(s).request/get', new RegExp('\\bhttps?' + '\\.(request|get)\\(')],
    ];
    const hits: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const [label, re] of banned) if (re.test(text)) hits.push(`${path.relative(root, file)}: ${label}`);
    }
    expect(hits).toEqual([]);
  });

  it('(7) engines: Node >=22.13 (node:sqlite without a flag) and VS Code ^1.146.0', () => {
    expect(pkg.engines.node).toBe('>=22.13');
    expect(pkg.engines.vscode).toBe('^1.146.0');
  });

  it('the CLI reports the package version', () => {
    const cli = read('src/cli/index.ts');
    expect(cli).toContain(`const VERSION = '${pkg.version}';`);
  });
});
