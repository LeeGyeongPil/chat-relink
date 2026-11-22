import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // The real `vscode` module only exists inside the extension host.
      vscode: fileURLToPath(new URL('./test/mocks/vscode.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
    // The runner's own locale, time zone and chat-relink settings must not leak into the tests.
    // Empty means "not set" for every variable below.
    env: {
      LANG: 'C',
      LC_ALL: '',
      LC_MESSAGES: '',
      TZ: 'UTC',
      CHAT_RELINK_LANG: '',
      CHAT_RELINK_USER_DATA_DIR: '',
      // safety net: a test that forgets to redirect the tool home writes to a temp folder, never to ~
      CHAT_RELINK_HOME: path.join(os.tmpdir(), 'chat-relink-vitest-home'),
    },
  },
});
