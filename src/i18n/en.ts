/** English message table. `ko.ts` must define exactly the same keys. Placeholders look like {name}. */
export const en = {
  'help.text': `chat-relink - find VS Code chats orphaned by a renamed, moved or re-cloned folder, and relink them safely

Usage:
  chat-relink <command> [options]

Commands:
  scan                         List workspace storage slots and which ones are orphaned
  show <slot|path>             Preview the sessions of one slot (title, turns, last date)
  relink --from <slot|path> --to <folder> [--sessions a,b] [--apply]
                               Copy sessions into the slot of <folder> (dry run unless --apply)
  undo <journal>               Revert a relink using its journal file
  export --from <slot|path> --out <dir>
                               Write one JSON per session for the official "Chat: Import Chat..."
  demo [--keep]                Run the whole flow on a synthetic practice fixture

Options:
  --user-data-dir <dir>        VS Code user data folder (default: per OS and --product)
  --product <name>             code | insiders | vscodium | cursor (default: code)
  --current <folder>           scan: rank orphans against this folder (default: current directory)
  --json                       Machine readable output
  --lang <en|ko>               Output language (default: CHAT_RELINK_LANG, then LC_ALL/LC_MESSAGES/LANG)
  --apply                      relink: really write (quit VS Code completely first)
  -h, --help                   Show this help
  -v, --version                Show the version

Exit codes: 0 ok, 1 failure, 2 usage, 3 VS Code is running, 4 verification failed (rolled back), 5 target slot missing`,

  'error.usage': 'Usage error: {detail}\nRun "chat-relink --help" for usage.',
  'error.unknownCommand': 'unknown command "{command}"',
  'error.missingCommand': 'no command given',
  'error.missingOption': 'missing option --{name}',
  'error.missingArgument': '"{command}" needs an argument: {what}',
  'error.badOption': '{detail}',
  'error.badProduct': 'unknown product "{product}" (use code, insiders, vscodium or cursor)',
  'error.badLang': 'unknown language "{lang}" (use en or ko)',
  'error.nodeVersion': 'chat-relink needs Node.js 22.13 or newer (found {version}).',
  'error.storageMissing': 'No workspaceStorage folder found at {dir}. Pass --user-data-dir or --product.',
  'error.slotNotFound': 'No workspace slot matches "{ref}". Run "chat-relink scan" to list them.',
  'error.slotAmbiguous': '"{ref}" matches {count} slots: {list}. Use a longer id prefix or the full folder path.',
  'error.targetNotFound': 'No slot found for the folder "{folder}". Open it in VS Code once, quit VS Code completely, then run this again.',
  'error.failure': 'Error: {message}',
  'error.running': 'VS Code is running (PID {pid}, {lockFile}). Quit it completely, then run this command again. Nothing was written.',
  'error.runningUndo': 'VS Code is running (PID {pid}). Quit it completely, then run undo again.',

  'status.ok': 'ok',
  'status.orphan': 'orphan',
  'status.skipped': 'skipped',
  'reason.remote': 'remote folder',
  'reason.multi-root': 'multi-root workspace',
  'reason.no-workspace-json': 'no workspace.json',
  'reason.unsupported-uri': 'unsupported URI',

  'scan.header': 'Slots in {dir}',
  'scan.columns': 'ID        STATUS                       SESSIONS  FOLDER',
  'scan.none': 'No slots found.',
  'scan.summary': '{orphans} orphaned slot(s) with chats, {skipped} skipped, {ok} ok.',
  'scan.candidates': 'Best matches for {folder}:',
  'scan.candidate': '  {id}  {name}  ({sessions} session(s), name match {nameScore}/3, {evidence} shared file(s))',
  'scan.noCandidates': 'No orphaned slot looks related to {folder}.',
  'scan.next': 'Preview with: chat-relink show <id>',

  'show.header': 'Sessions in slot {id} ({folder})',
  'show.columns': 'SESSION    TURNS  LAST        FORMAT  TITLE',
  'show.warning': '  warning: {text}',
  'show.error': '  cannot read: {text}',
  'show.twin': '  note: a legacy .json with the same id exists; the .jsonl is used',
  'show.empty': 'This slot has no chat sessions.',

  'relink.planHeader': 'Plan: relink from {from} to {to}',
  'relink.item': '  {action}  {id}  {turns} turn(s)  {title}',
  'relink.action.copy': 'copy',
  'relink.action.skip': 'skip',
  'relink.reason.exists': 'already in target',
  'relink.reason.unreadable': 'unreadable',
  'relink.itemReason': '        reason: {reason}',
  'relink.indexCount': 'Index entries in target: {before} -> {after}',
  'relink.dryRun': 'Dry run: nothing was written. Quit VS Code completely, then add --apply to write.',
  'relink.warningRunning': 'Warning: {text}',
  'relink.applied': 'Relinked {count} session(s).',
  'relink.backup': 'Backup:    {path}',
  'relink.journal': 'Journal:   {path}',
  'relink.integrity': 'integrity_check: {result}',
  'relink.undoHint': 'To revert: chat-relink undo "{path}"',
  'relink.nothingToCopy': 'Nothing to copy (all selected sessions are skipped).',
  'relink.verifyFailed': 'Verification failed and everything was rolled back: {detail}',

  'undo.done': 'Undo complete ({mode}): removed {files} file(s) and {entries} index entr(ies).',
  'undo.mode.restored-backup': 'database restored from backup',
  'undo.mode.removed-entries': 'only the entries added by relink were removed',
  'undo.confirmed': 'Confirmed: the target slot is back to its state before relink.',
  'undo.notConfirmed': 'Warning: some changes could not be confirmed as reverted.',

  'export.warning': 'Warning: exported chats can contain secrets, tokens and file contents. Review them before sharing.',
  'export.wrote': 'Wrote {count} file(s) to {dir}',
  'export.line': '  {file}  ({requests} request(s))',
  'export.import': 'Open one with the VS Code command "Chat: Import Chat...".',

  'lock.stale': 'Found a leftover VS Code lock file; continuing.',

  'demo.banner': 'chat-relink demo: practice fixture. Synthetic data in a temporary folder; your VS Code data is not read.',
  'demo.step1': 'Create a synthetic workspaceStorage, then rename the project folder',
  'demo.step1.detail': '  renamed {from} -> {to}; storage id {oldId} -> {newId}',
  'demo.step2': 'Scan: which slots lost their folder?',
  'demo.step3': 'Preview the orphaned sessions',
  'demo.step4': 'Plan the relink (dry run, nothing is written)',
  'demo.step5': 'Try to write while "VS Code" is running',
  'demo.step5.detail': '  a live PID is in code.lock, so relink refuses (exit code 3)',
  'demo.step6': 'Relink for real: backup, copy, update index, verify',
  'demo.step7': 'The lesson: why we never write while VS Code runs',
  'demo.step7.detail': '  a running VS Code caches the index and rewrites all of it on the next chat save',
  'demo.step8': 'Undo with the journal',
  'demo.cleanup': 'Temporary folder removed.',
  'demo.kept': 'Kept the practice folder: {dir}',

  'ext.found': "Found {count} chat(s) from a previous folder '{name}'.",
  'ext.review': 'Review',
  'ext.notNow': 'Not now',
  'ext.never': 'Never for this folder',
  'ext.noOrphans': 'No orphaned chats were found.',
  'ext.pickSessions': 'Select the chats to open or relink',
  'ext.pickAction': 'What should happen with {count} chat(s)?',
  'ext.action.open': 'Open as imported copies (safe while VS Code runs)',
  'ext.action.relink': 'Relink permanently... (needs VS Code closed)',
  'ext.itemDetail': '{turns} turn(s) | {date}',
  'ext.opened': 'Opened {count} imported cop(ies). They may get a new id and date; the originals are untouched.',
  'ext.planSaved': 'Plan saved to {path}. Quit VS Code completely, then paste the copied command into a terminal.',
  'ext.importFailed': 'Could not open "{title}": {error}',

  'core.noSession': 'No session matches "{w}" in slot {slot}. Run "chat-relink show {slot}" to list them.',
  'core.ambiguous': '"{w}" matches {count} sessions. Use a longer id prefix.',
  'core.sameSlot': 'Source and target are the same slot.',
  'core.notOrphan': 'Source slot {id} is not an orphan (status: {status}).',
  'core.noTargetDb': 'Target slot {id} has no state.vscdb yet. Open that folder in VS Code once, quit VS Code, then run this again.',
  'core.indexOverLimit': 'The index would hold {after} entries; VS Code keeps about {limit}, so the oldest chats may drop out of the history list (their files stay on disk).',
  'core.journalMissing': 'Journal is missing or damaged: {file}',
  'core.journalShape': 'Journal is damaged (unexpected shape): {file}',
  'core.untitled': '(untitled)',
  'core.unreadable': '(unreadable)',
  'core.running': 'VS Code is running (PID {pid}, {lockFile}). Quit it completely, then run this command again. Nothing was written.',
  'core.runningUndo': 'VS Code is running (PID {pid}). Quit it completely, then run undo again.',
  'core.staleLock': 'Found a leftover {lockFile} from a VS Code that is no longer running; continuing.',
  'core.sourceIndexUnreadable': 'The source index could not be read; titles are rebuilt from the session files.',
  'core.rolledBack': 'Relink failed and was rolled back: {detail}',
  'core.verifyFailed': 'Verification failed; everything was rolled back. {failures}',
  'core.alreadyUndone': 'This journal is already undone; nothing to undo.',
  'core.alreadyRolledBack': 'This journal is already rolled-back; nothing to undo.',
  'core.backupGone': 'The backup recorded in the journal is gone: {path}',
  'verify.integrity': 'integrity_check returned "{result}"',
  'verify.indexMissing': 'index entry missing for {id}',
  'verify.fileMissing': 'session file missing for {id}',
  'verify.entryGone': 'pre-existing index entry {id} disappeared',
  'verify.keyChanged': 'unrelated key "{key}" changed',
  'verify.reread': 'state database could not be re-read: {detail}',
  'verify.sourceChanged': 'the source slot changed',
  'verify.injected': 'injected verification fault',
  'log.empty': 'Empty log file',
  'log.badLine': 'Log line {n} is not valid JSON',
  'log.noInitial': 'Log file is missing an initial entry',
  'log.truncated': 'Line {n} is truncated or damaged; replayed the earlier lines only',
  'log.noPath': 'Line {n}: entry without a path was skipped',
  'log.pathMissing': 'Line {n}: path {path} does not exist; entry skipped',
  'log.notArray': 'Line {n}: {path} is not an array; append skipped',
  'log.unknownKind': 'Line {n}: unknown entry kind {kind} was skipped',
  'log.fileBadJson': 'Session file is not valid JSON',
  'log.fileNotObject': 'Session file does not contain an object',
  'db.noSqlite': 'node:sqlite is not available. Use Node.js 22.13 or newer.',
  'db.notFound': 'State database not found: {file}',
  'db.indexBadJson': '{key} is not valid JSON. Restore the state database from a backup.',
  'db.indexVersion': '{key} has version {version}; only version 1 is supported. Refusing to write.',
  'db.backupExists': 'Backup already exists: {path}',
} as const;

export type MessageKey = keyof typeof en;
