import type { MessageKey } from './en';

/** 한국어 메시지 표. 키 집합은 `en.ts` 와 정확히 같아야 한다(테스트가 확인). */
export const ko: Record<MessageKey, string> = {
  'help.text': `chat-relink - 폴더 이름 변경·이동·재클론으로 고아가 된 VS Code 채팅을 찾아 안전하게 다시 연결합니다

사용법:
  chat-relink <명령> [옵션]

명령:
  scan                         workspaceStorage 칸 목록과 고아 칸을 보여 줍니다
  show <칸|경로>               한 칸의 세션을 미리 봅니다(제목, 턴 수, 마지막 날짜)
  relink --from <칸|경로> --to <폴더> [--sessions a,b] [--apply]
                               <폴더>의 칸으로 세션을 복사합니다(--apply 가 없으면 dry-run)
  undo <저널>                  저널 파일로 relink 를 되돌립니다
  export --from <칸|경로> --out <폴더>
                               공식 "Chat: Import Chat..." 용으로 세션마다 JSON 을 씁니다
  demo [--keep]                합성 연습용 데이터로 전체 흐름을 실행합니다

옵션:
  --user-data-dir <폴더>       VS Code 사용자 데이터 폴더(기본값: OS·--product 에 따름)
  --product <이름>             code | insiders | vscodium | cursor (기본값: code)
  --current <폴더>             scan: 이 폴더를 기준으로 고아 칸 순위를 매깁니다(기본값: 현재 디렉터리)
  --json                       기계가 읽는 출력
  --lang <en|ko>               출력 언어(기본값: CHAT_RELINK_LANG, 그다음 LC_ALL/LC_MESSAGES/LANG)
  --apply                      relink: 실제로 씁니다(먼저 VS Code 를 완전히 종료하세요)
  -h, --help                   도움말
  -v, --version                버전

종료 코드: 0 성공, 1 실패, 2 사용법, 3 VS Code 실행 중, 4 검증 실패(되돌림), 5 대상 칸 없음`,

  'error.usage': '사용법 오류: {detail}\n"chat-relink --help" 로 사용법을 확인하세요.',
  'error.unknownCommand': '알 수 없는 명령 "{command}"',
  'error.missingCommand': '명령이 없습니다',
  'error.missingOption': '--{name} 옵션이 없습니다',
  'error.missingArgument': '"{command}" 에는 인자가 필요합니다: {what}',
  'error.badOption': '{detail}',
  'error.badProduct': '알 수 없는 제품 "{product}" (code, insiders, vscodium, cursor 중 하나)',
  'error.badLang': '알 수 없는 언어 "{lang}" (en 또는 ko)',
  'error.nodeVersion': 'chat-relink 는 Node.js 22.13 이상이 필요합니다(현재 {version}).',
  'error.storageMissing': '{dir} 에 workspaceStorage 폴더가 없습니다. --user-data-dir 또는 --product 를 지정하세요.',
  'error.slotNotFound': '"{ref}" 에 맞는 칸이 없습니다. "chat-relink scan" 으로 목록을 확인하세요.',
  'error.slotAmbiguous': '"{ref}" 에 맞는 칸이 {count}개입니다: {list}. 더 긴 id 앞부분이나 전체 폴더 경로를 쓰세요.',
  'error.targetNotFound': '"{folder}" 폴더의 칸을 찾지 못했습니다. VS Code 로 그 폴더를 한 번 열고 VS Code 를 완전히 종료한 뒤 다시 실행하세요.',
  'error.failure': '오류: {message}',
  'error.running': 'VS Code 가 실행 중입니다 (PID {pid}, {lockFile}). VS Code 를 완전히 종료한 뒤 이 명령을 다시 실행하세요. 아무것도 쓰지 않았습니다.',
  'error.runningUndo': 'VS Code 가 실행 중입니다 (PID {pid}). VS Code 를 완전히 종료한 뒤 undo 를 다시 실행하세요.',

  'status.ok': '정상',
  'status.orphan': '고아',
  'status.skipped': '건너뜀',
  'reason.remote': '원격 폴더',
  'reason.multi-root': '멀티 루트 작업 영역',
  'reason.no-workspace-json': 'workspace.json 없음',
  'reason.unsupported-uri': '지원하지 않는 URI',

  'scan.header': '{dir} 의 칸 목록',
  'scan.columns': 'ID        상태                         세션      폴더',
  'scan.none': '칸이 없습니다.',
  'scan.summary': '채팅이 있는 고아 칸 {orphans}개, 건너뜀 {skipped}개, 정상 {ok}개.',
  'scan.candidates': '{folder} 와(과) 가장 비슷한 후보:',
  'scan.candidate': '  {id}  {name}  (세션 {sessions}개, 이름 일치 {nameScore}/3, 공통 파일 {evidence}개)',
  'scan.noCandidates': '{folder} 와(과) 관련 있어 보이는 고아 칸이 없습니다.',
  'scan.next': '미리 보기: chat-relink show <id>',

  'show.header': '칸 {id} ({folder}) 의 세션',
  'show.columns': '세션       턴     마지막      형식    제목',
  'show.warning': '  경고: {text}',
  'show.error': '  읽을 수 없음: {text}',
  'show.twin': '  참고: 같은 id 의 구형 .json 이 있어 .jsonl 을 사용합니다',
  'show.empty': '이 칸에는 채팅 세션이 없습니다.',

  'relink.planHeader': '계획: {from} 에서 {to} 로 relink',
  'relink.item': '  {action}  {id}  {turns}턴  {title}',
  'relink.action.copy': '복사',
  'relink.action.skip': '건너뜀',
  'relink.reason.exists': '대상에 이미 있음',
  'relink.reason.unreadable': '읽을 수 없음',
  'relink.itemReason': '        이유: {reason}',
  'relink.indexCount': '대상 색인 항목 수: {before} -> {after}',
  'relink.dryRun': 'Dry-run: 아무것도 쓰지 않았습니다. VS Code 를 완전히 종료한 뒤 --apply 를 붙이면 씁니다.',
  'relink.warningRunning': '경고: {text}',
  'relink.applied': '세션 {count}개를 다시 연결했습니다.',
  'relink.backup': '백업:      {path}',
  'relink.journal': '저널:      {path}',
  'relink.integrity': 'integrity_check: {result}',
  'relink.undoHint': '되돌리기: chat-relink undo "{path}"',
  'relink.nothingToCopy': '복사할 것이 없습니다(선택한 세션이 모두 건너뜀).',
  'relink.verifyFailed': '검증에 실패해 모두 되돌렸습니다: {detail}',

  'undo.done': '되돌리기 완료({mode}): 파일 {files}개, 색인 항목 {entries}개를 제거했습니다.',
  'undo.mode.restored-backup': '백업에서 DB 복원',
  'undo.mode.removed-entries': 'relink 가 추가한 항목만 제거',
  'undo.confirmed': '확인: 대상 칸이 relink 이전 상태로 돌아왔습니다.',
  'undo.notConfirmed': '경고: 일부 변경이 되돌려졌는지 확인하지 못했습니다.',

  'export.warning': '경고: 내보낸 채팅에는 비밀 값·토큰·파일 내용이 들어 있을 수 있습니다. 공유하기 전에 확인하세요.',
  'export.wrote': '{dir} 에 파일 {count}개를 썼습니다',
  'export.line': '  {file}  (요청 {requests}개)',
  'export.import': 'VS Code 명령 "Chat: Import Chat..." 으로 하나씩 열 수 있습니다.',

  'lock.stale': '이전 VS Code 가 남긴 잠금 파일이 있어 계속 진행합니다.',

  'demo.banner': 'chat-relink 데모: 연습용 합성 데이터입니다. 임시 폴더의 가짜 데이터만 쓰며 실제 VS Code 데이터는 읽지 않습니다.',
  'demo.step1': '합성 workspaceStorage 를 만들고 프로젝트 폴더 이름을 바꿉니다',
  'demo.step1.detail': '  {from} -> {to} 이름 변경, 저장소 id {oldId} -> {newId}',
  'demo.step2': '스캔: 어떤 칸이 폴더를 잃었나?',
  'demo.step3': '고아 세션 미리 보기',
  'demo.step4': 'relink 계획(dry-run, 아무것도 쓰지 않음)',
  'demo.step5': '"VS Code" 가 실행 중일 때 쓰기 시도',
  'demo.step5.detail': '  code.lock 에 살아 있는 PID 가 있어 relink 가 거부합니다(종료 코드 3)',
  'demo.step6': '실제 relink: 백업, 복사, 색인 갱신, 검증',
  'demo.step7': '교훈: VS Code 실행 중에는 쓰면 안 되는 이유',
  'demo.step7.detail': '  실행 중인 VS Code 는 색인을 메모리에 두었다가 다음 채팅 저장 때 통째로 다시 씁니다',
  'demo.step8': '저널로 되돌리기',
  'demo.cleanup': '임시 폴더를 지웠습니다.',
  'demo.kept': '연습 폴더를 남겼습니다: {dir}',

  'ext.found': "이전 폴더 '{name}' 의 채팅 {count}개를 찾았습니다.",
  'ext.review': '확인',
  'ext.notNow': '나중에',
  'ext.never': '이 폴더에서는 다시 묻지 않기',
  'ext.noOrphans': '고아 채팅을 찾지 못했습니다.',
  'ext.pickSessions': '열거나 다시 연결할 채팅을 선택하세요',
  'ext.action.open': '가져온 사본으로 열기(VS Code 실행 중에도 안전)',
  'ext.pickAction': '채팅 {count}개를 어떻게 할까요?',
  'ext.action.relink': '영구 재연결... (VS Code 종료 필요)',
  'ext.itemDetail': '{turns}턴 | {date}',
  'ext.opened': '가져온 사본 {count}개를 열었습니다. 새 id 와 날짜가 붙을 수 있으며 원본은 그대로입니다.',
  'ext.planSaved': '계획을 {path} 에 저장했습니다. VS Code 를 완전히 종료한 뒤 복사된 명령을 터미널에 붙여 넣으세요.',
  'ext.importFailed': '"{title}" 을(를) 열 수 없습니다: {error}',

  'core.noSession': '칸 {slot} 에 "{w}" 와 일치하는 세션이 없습니다. "chat-relink show {slot}" 로 목록을 확인하세요.',
  'core.ambiguous': '"{w}" 가 세션 {count}개와 일치합니다. 더 긴 id 앞부분을 쓰세요.',
  'core.sameSlot': '원본과 대상이 같은 칸입니다.',
  'core.notOrphan': '원본 칸 {id} 은(는) 고아가 아닙니다(상태: {status}).',
  'core.noTargetDb': '대상 칸 {id} 에 아직 state.vscdb 가 없습니다. 그 폴더를 VS Code 에서 한 번 연 뒤 VS Code 를 종료하고 다시 실행하세요.',
  'core.indexOverLimit': '색인이 {after}개 항목을 담게 됩니다. VS Code 는 약 {limit}개만 유지하므로 가장 오래된 채팅이 기록 목록에서 빠질 수 있습니다(파일은 디스크에 남습니다).',
  'core.journalMissing': '저널이 없거나 손상되었습니다: {file}',
  'core.journalShape': '저널이 손상되었습니다(예상과 다른 형식): {file}',
  'core.running': 'VS Code 가 실행 중입니다(PID {pid}, {lockFile}). 완전히 종료한 뒤 이 명령을 다시 실행하세요. 아무것도 쓰지 않았습니다.',
  'core.runningUndo': 'VS Code 가 실행 중입니다(PID {pid}). 완전히 종료한 뒤 undo 를 다시 실행하세요.',
  'core.staleLock': '더 이상 실행 중이 아닌 VS Code 가 남긴 {lockFile} 을(를) 찾았습니다. 계속 진행합니다.',
  'core.sourceIndexUnreadable': '원본 색인을 읽을 수 없어 세션 파일에서 제목을 다시 만듭니다.',
  'core.rolledBack': 'relink 가 실패해 되돌렸습니다: {detail}',
  'core.verifyFailed': '검증에 실패해 모두 되돌렸습니다. {failures}',
  'core.alreadyUndone': '이 저널은 이미 되돌려졌습니다. 되돌릴 것이 없습니다.',
  'core.alreadyRolledBack': '이 저널은 이미 롤백되었습니다. 되돌릴 것이 없습니다.',
  'core.backupGone': '저널에 기록된 백업이 사라졌습니다: {path}',
  'verify.integrity': 'integrity_check 결과가 "{result}" 입니다',
  'verify.indexMissing': '{id} 의 색인 항목이 없습니다',
  'verify.fileMissing': '{id} 의 세션 파일이 없습니다',
  'verify.entryGone': '기존 색인 항목 {id} 이(가) 사라졌습니다',
  'verify.keyChanged': '관련 없는 키 "{key}" 가 바뀌었습니다',
  'verify.reread': '상태 DB 를 다시 읽을 수 없습니다: {detail}',
  'verify.sourceChanged': '원본 칸이 바뀌었습니다',
  'verify.injected': '주입된 검증 오류',
  'log.empty': '로그 파일이 비어 있습니다',
  'log.badLine': '로그 {n}번째 줄이 올바른 JSON 이 아닙니다',
  'log.noInitial': '로그 파일에 첫 항목이 없습니다',
  'log.truncated': '{n}번째 줄이 잘렸거나 손상되어 앞의 줄만 재생했습니다',
  'log.noPath': '{n}번째 줄: 경로 없는 항목을 건너뛰었습니다',
  'log.pathMissing': '{n}번째 줄: 경로 {path} 가 없어 항목을 건너뛰었습니다',
  'log.notArray': '{n}번째 줄: {path} 이(가) 배열이 아니어서 추가를 건너뛰었습니다',
  'log.unknownKind': '{n}번째 줄: 알 수 없는 항목 종류 {kind} 을(를) 건너뛰었습니다',
  'log.fileBadJson': '세션 파일이 올바른 JSON 이 아닙니다',
  'log.fileNotObject': '세션 파일에 객체가 없습니다',
  'db.noSqlite': 'node:sqlite 를 쓸 수 없습니다. Node.js 22.13 이상을 쓰세요.',
  'db.notFound': '상태 DB 를 찾을 수 없습니다: {file}',
  'db.indexBadJson': '{key} 이(가) 올바른 JSON 이 아닙니다. 백업에서 상태 DB 를 복원하세요.',
  'db.indexVersion': '{key} 의 버전이 {version} 입니다. 버전 1 만 지원하므로 쓰기를 거부합니다.',
  'db.backupExists': '백업이 이미 있습니다: {path}',
};
