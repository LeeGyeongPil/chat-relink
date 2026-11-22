# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
