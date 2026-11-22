# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3] - 2026-11-23

### Changed
- CI is now a single job: Ubuntu 24.04, Node 24, `npm ci` -> `npm run typecheck` -> `npm test` (no Node matrix, no weekly schedule, no demo step, no npm cache).
- `@vscode/vsce` is no longer a devDependency. `npm run package` downloads `@vscode/vsce@4.1.1` with `npx` at release time (needs network).
- devDependencies are pinned to exact versions (`typescript` 7.0.2, `vitest` 5.1.1, `@types/node` 24.19.2, `@types/vscode` 1.146.0); the lock file was updated in place.
- Environment inputs are injectable and the tests pass fixed values: folder id (`platform`, `stat`), user data paths (`platform`, `env`, `homedir`), running check (`readLock`, `isAlive`), language (`argv`, `env`). The practice fixture builds its ids from fixed fake birthtime/inode values.
- New script `npm run typecheck` (`tsc --noEmit`).

### Added
- `test/repoHygiene.test.ts`: offline checks of the CI workflow, lock file sync, install scripts, Linux binaries in the lock and host-dependent patterns in tests.

## [0.1.2] - 2026-11-23

### Fixed
- `run()` (the CLI entry used in-process by tests) no longer replaces the process-wide `warning` listeners; only the real `chat-relink` process hides the `node:sqlite` ExperimentalWarning, now for every command.

### Changed
- README: documented `CHAT_RELINK_HOME` and how to try commands on `demo --keep` data; test count 82.

## [0.1.1] - 2026-11-23

### Added
- Cross-platform tests: the full scan, relink and undo flow with the Linux (inode) and macOS (birthtime) id rules, and with reversed directory listings.

### Fixed
- Running-guard and undo tests no longer depend on the host platform (dead PID above Linux `pid_max`, sorted file lists).
- Preview output is now translated through the English and Korean messages.

### Changed
- CI runs on Ubuntu with Node 22.13 (the lowest supported version) and the current LTS.
- README: test count, section titles, refreshed screenshots, note on `npx` before the package is published.

## [0.1.0] - 2026-11-22

### Added
- Core: user data folder lookup (VS Code, Insiders, VSCodium, Cursor), workspace id rules for macOS, Windows, Linux and remote URIs, orphan scan with ranked candidates, `.jsonl` mutation log replay (kind 0-3, BOM, truncated last line) and legacy `.json` sessions, export JSON for the official `workbench.action.chat.import` command.
- State database handling with `node:sqlite`: `VACUUM INTO` backup, transactional index update, `integrity_check`, verification and automatic rollback.
- CLI `chat-relink`: `scan`, `show`, `relink` (dry run by default), `undo`, `export`, `demo`; exit codes 0-5; `--lang en|ko`, `CHAT_RELINK_LANG`.
- Running VS Code protection through `code.lock` (live PID blocks writes with exit code 3).
- Read-only VS Code extension: startup notification, `Chat Relink: Find Orphaned Chats`, QuickPick preview, open as imported copies, save a relink plan and copy the CLI command; `chatRelink.language` setting.
- English and Korean messages for the CLI and the extension.
