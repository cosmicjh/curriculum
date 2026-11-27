# 실제 수행한 검증 · 2026-10-30

## 시수배당 학기 전환

- `node modules/allocation/tests/term-switch-browser.mjs`는 머리의 관리자 전용 전환 버튼, 보관본 복원, 빈 학기 생성, 학교 설정 저장 시 학기 불변을 검증한다. 설정 폼과 배당표의 미저장 변경, 저장 요청이 진행 중일 때의 전환 차단도 확인한다.
- 통합시간표 활성 학기와 다를 때만 차이를 표시하고 그 학기를 전환 창의 기본 대상으로 제안한다. 두 학기가 같으면 다음 학기를 제안한다. 통합시간표에서 학기를 바꿔도 열린 시수배당표의 설정 입력은 유지하고 차이 표시만 갱신한다. 교사는 버튼과 보관 목록에 접근할 수 없고 서버도 전환을 거부한다. 전환 창과 머리는 1440px 및 390px에서 공통 UI 규칙을 검사한다.

## 시수배당 단일 DB 검증 계약

[승인 설계](design/platform-consolidation.md)에 따라 기존 시수배당 권한·검증을 플랫폼 인증 경계로 옮겼다. 교사 입력·제출과 관리자 구조 수정·확정·재개를 유지한다.

- `pnpm test`는 두 모듈의 단위·D1 시험을 실행한다. 과목·분반 권한, 학생·비로그인·교사 정책, 버전 충돌, operationId 재시도, ID 중복, 글로벌 트랜잭션, JS 모델 내보내기와 CP-SAT/Python 골든 비교를 확인한다.
- `pnpm test:browser`에는 실제 플랫폼 교사·관리자 로그인, 입력·충돌·유실 응답 재시도, 제출·확정·재개, 분반배정 가져오기, JSON 백업·복원, CSV, 양식과 입력 내용 인쇄 SVG, 데스크톱·390px UI가 포함된다. `pnpm test:pages-browser`는 두 출처 환경의 메모리 세션으로 같은 시수배당 iframe을 확인한다.
- `pnpm test:course-migration`은 관리자 전용 이관 Worker의 바인딩·분할 복사·원본/대상 전체 해시, 대조 스냅샷, 150,000바이트 및 1,500,000바이트 교과군과 보관 학기를 검증한다. 이전 경로 차단, 배포 버전, 재실행, 불일치 거부, 해제 후 쓰기 및 명령·자식 로그의 민감값 비노출을 가상 자료로 확인한다.
- 이관 시험은 원본 업무·인증 테이블의 동결 트리거 설치·확인·제거와 쓰기 거부를 검사한다. 해제 재스캔에서 이미 읽은 원본 교과군에 늦은 저장을 보내면 거부된다. 동결 트리거가 하나라도 빠지면 해제를 거부하며, 해제 뒤에도 27개가 남는다.
- 일부 트리거 누락 뒤 늦은 저장을 주입하고 복구하면 27개가 새 세대가 된다. 이전 검증을 사용한 Worker 해제와 늦은 원복의 동결 제거를 거부한다. 원복이 예약된 상태에서 해제가 거부되며, 진행 중·완료된 해제 상태의 원복은 종료 코드 1이다.
- 실제 `eb75f3c` 핸들러에 이전 주소 검사용 GET 요청을 보내고 SQL 실행이 없는지 확인한다. 잘못된 교사 참조와 손상된 엔터티 ID 인덱스는 무결성 검사에서 중단된다. 운영 DB는 시험에서 사용하지 않는다.
- 원복 리허설은 이전 배포로 되돌렸다고 가정하고 동결 트리거를 제거해 원본 D1에 새 저장을 한 뒤, 다시 동결하고 미해제 대상만 백업·정리하여 새 원본을 재이관한다. 실제 이전 Worker/Pages의 재배포, 원격 Time Travel 발급·복구, 원격 D1 성능은 별도 운영 검증 범위다. [이관과 원복](COURSE_ALLOCATION_MIGRATION.md)
- 0017 스키마·Worker 버전 검증에 실패하면 동결 명령이 원본 자료와 스키마를 그대로 둔다. 임시 Worker를 종료한 상태에서 로컬 Wrangler가 공통 DB 원복 예약을 취득해 비상 원복한다. 해제 검증 중(`release-check`, `release-ready`)과 `released`에서는 종료 코드 1로 원본 동결을 보존한다. 상태·비상 원복의 출력과 Wrangler 로그 파일에 가상 자료 표식이 남지 않는지도 확인한다.
- 상태 조회 직후 해제 검증이 시작되면 SQLite가 비상 원복 예약을 거부한다. 비상 원복 예약이 먼저면 Worker와 SQLite 가드가 해제 진행을 거부한다. 동결 제거 뒤 예약을 정리하면 이전 진행 토큰이 무효화되고 대상 쓰기는 계속 잠겨 있다. 이관 행이 없는 대상의 원복 예약도 두 상태 명령에 표시된다. 원본 DDL 뒤에 남은 예약을 끝내기 전에는 재동결을 거부한다.
- 이전 주소가 HTTP 404여도 관리자와 현 진행 토큰으로 해제 검증을 취소하고 일반 원복할 수 있다. 취소는 진행 위치·해시를 지우고 토큰을 교체한다. 이전 토큰으로 검증을 진행하거나 재검증 후 해제할 수 없고, `released`에서는 취소가 거부된다.
- API 시험은 0015의 source_freeze 누락을 포함한 미적용 스키마 503과 빈 저장소 503을 구분한다. 원본 동결 오류는 세대 값을 제외한 간단한 503 안내를 반환한다. 추가로 검증 뒤 세션 만료·폐기를 D1 쓰기 가드가 차단하는지 확인한다. 분반배정 가져오기는 명시된 같은 학년에서 유효한 기존 시수 4를 파일 시수 3보다 우선한다. 학년 없는 시트는 파일 시수 3을 사용한다.
- Python은 저장소 루트에서 `timetable-solver/runtime/python.exe -m unittest discover -s timetable-solver/tests`를 실행한다. `PYTHONPATH`는 `timetable-solver`로 지정한다. 원본의 Windows runtime을 재사용할 때 임베디드 Python은 원본 모듈을 우선할 수 있다. 이 경우 `-c "import sys,runpy; sys.path.insert(0, 'timetable-solver'); runpy.run_module('unittest', run_name='__main__')" discover -s timetable-solver/tests`로 현재 체크아웃을 먼저 지정한다.

## 2026-11-16 모듈 UI 통일 검증

이번 변경은 승인 설계 `course-allocation/docs/design/ui-unification-optimization.md`의 B 작업이다. 공통 CSS를 일반 페이지·분반배정 iframe·결보강 Shadow DOM에 먼저 연결하고, 모듈 토큰·텍스트 버튼·카드 구획·회색 좌석 상태·솔버 단계 표시·글꼴 범위를 정리했다. 인쇄 양식, 서버, 마이그레이션, 자료 및 백업 형식은 보존했다.

- `tests/ui-browser.mjs`는 로그인·교사 7개 모듈·관리자 6개 모듈·스터디룸 학생·브라우저 솔버를 1440px와 390px에서 검사한다. iframe과 Shadow DOM까지 공통 토큰, 서브셋 우선 글꼴, 가로 넘침, 버튼 배경·테두리, 데스크톱 32px·모바일 44px 클릭 높이와 비활성 밑줄을 확인한다. 데이터 셀과 사이드바 활성 배경은 명시적 예외다.
- `tests/ui.test.mjs`는 모듈 CSS·공통 CSS·결보강 뷰·글꼴 CSS 해시와 회색조를 고정하고, 전체 글꼴의 문자 범위가 일반 한글·영문·숫자를 제외하고 드문 한글을 포함하는지 검사한다. 기존 원본 WOFF2 해시는 유지한다.
- `tests/studyroom-browser.mjs`의 이전 배경색과 밑줄 기대값을 승인된 회색 토큰 및 텍스트 버튼 hover 규칙으로 갱신했다.
- 기능 검증은 `package.json`의 `test:all` 전체 명령과 신규 `test:ui`를 실행한다. 현재 셸에는 pnpm 실행 파일이 없어 Node 24.22.1로 각 스크립트의 Node 명령을 같은 순서로 직접 실행했다. 전체 로그는 Git 제외 `test-results/ui-all.log`에 있다.
- 최종 결과: 단위·통합 71/71, 일반 브라우저·솔버·분반배정·Pages·로컬 Wrangler·결보강·배치표·스터디룸 및 신규 UI 32개 화면 검사가 모두 통과했다. 변경한 CSS 7개도 esbuild 구문 검사 경고 없이 통과했다.
- Orca 브라우저에서 로그인·분반배정·결보강의 데스크톱과 모바일 렌더를 확인했다. 기존 브라우저 시험의 PNG·인쇄·FHD 배치표·모바일 스터디룸 검사도 유지한다.
- Impeccable 수동 검사는 실행했다. 경고·예약 수업을 나타내는 기존 줄무늬는 업무 상태 표시이며, 소스 파일에서 해석할 수 없는 배포 경로 CSS 연결은 빌드 결과와 브라우저 시험으로 확인한다.

상위 시수배당 vendor HTML/JS 동기화는 이 작업 범위 밖이다. 최종 원본 `shared/ui.css` 교체 뒤 `tests/fixtures/ui-baseline.json`의 해당 해시를 다시 고정하고 전체 시험을 실행해야 한다. 글꼴 전송량의 실제 변경 전후 수치는 [PERFORMANCE.md](PERFORMANCE.md)의 2026-11-16 기록을 따른다.

아래는 최초 전환 검증 당시의 기록입니다. 이후 [2026-11-02 main 반영·정리](MAIN_RELEASE_2026-11-02.md)를 진행했으며, 이번 단계는 성능 개선·성능 측정을 포함하지 않습니다.

## 작업 위치와 보존 범위

처음 열린 저장소는 다른 서비스인 교과 시수배당 `course-allocation`이었습니다. 현재 `cosmicjh/curriculum`인 저장소를 작업 폴더의 `timetable-cloudflare/`에 별도 복제하고 `codex/workers-d1` 브랜치에서 구현했습니다. 원본은 bd6e7db입니다. 시수배당 코드·배포·DB와 기존 개인시간표 GitHub Pages·Apps Script·스프레드시트를 수정하거나 삭제하지 않았습니다. 이 문서의 초기 로컬 검증 후, 후속 작업에서 원격 브랜치 푸시와 Cloudflare 배포를 수행했습니다. main 병합은 하지 않았습니다. [실제 배포 결과](DEPLOYED_2026-10-30.md)를 함께 확인하세요.

## 실행 환경

Windows, Node.js 24.22.1, pnpm 11.25.0, Miniflare 4.20260730.0, Wrangler 4.154.0, Playwright 1.64.1, Microsoft Edge headless. compatibility_date는 설치된 양쪽 workerd가 지원하는 2026-07-30입니다. 잠금 파일에 맞춰 이 복제본의 의존성을 별도로 설치했습니다.

## 결과

| 검증 | 실제 결과 |
| --- | --- |
| `pnpm test` | 19/19 통과; Core 원본 가상 결과, 실제 D1 저장·권한·동시 수정 |
| `pnpm test:browser` | 9/9 시나리오 통과, 브라우저 JS 오류 0건 |
| `pnpm test:worker` | Wrangler 새 로컬 D1 마이그레이션, deploy dry-run, live dev 라우팅 통과 |
| 원본 화면 보존 | 네 HTML·HTML 내장 Pretendard·style.css 정규화 SHA-256 일치 |
| 원본 계산 | 학생·교사 시간표, 분반 명렬표가 원본 Core.gs의 가상 기대 결과와 동일 |
| 실제 교사 엑셀 | 읽기 전용 파싱, 교사 64명·133행, 요일별 7/7/6/7/7교시 자동 감지 |
| 운영 학생 자료 이관 | 미수행; 학생 배정·선택과목 원본·운영 JSON 백업 미제공 |
| 원격 배포 | 후속 작업에서 완료; Worker·전용 D1·Secret 연결·실제 HTTPS 검증 완료 |
| 원격 운영 학생 자료 이관 | 미수행; 운영 원본 미제공 |

통합 시험은 Miniflare의 실제 D1 SQLite 바인딩을 사용합니다. 별도 테스트 Worker의 SQL 통로는 tests/worker.mjs에만 있으며 배포 entry에는 포함되지 않습니다. Wrangler 검증은 매 실행마다 새 persist 디렉터리의 로컬 D1을 생성합니다. 운영 DB에는 테스트 SQL을 실행하지 않습니다.

### 분반배정 대상 학기 전환 · 2026-11-26

독립 검토 수정 후 Node.js 24.22.1과 Edge에서 `test:all`의 구성 명령을 저장소에서 다시 실행했다.

| 실행 명령 | 종료 코드 | 통과 / 실패 |
| --- | --- | --- |
| `node --test --test-concurrency=1 tests/*.test.mjs modules/allocation/tests/*.test.mjs` | 0 | 190 / 0 |
| `node tests/browser.mjs` | 0 | 10 / 0 |
| `node tests/solver-browser.mjs` | 0 | 1 스위트 / 0 |
| `node tests/browser-solver.mjs` | 0 | 1 스위트 / 0 |
| `node modules/allocation/tests/browser.mjs` | 0 | 10 / 0 |
| `node modules/allocation/tests/term-switch-browser.mjs` | 0 | 6 / 0 |
| `node tests/section-assignment-browser.mjs` | 0 | 8 시나리오 그룹 / 0 |
| `node tests/pages-browser.mjs` | 0 | 12 / 0 |
| `tests/wrangler.mjs`의 Wrangler 로컬 시험 | 0 | 3 / 0 |
| `node tests/teacher-tools-browser.mjs` | 0 | 9 / 0 |
| `node tests/allocation-browser.mjs` | 0 | 23 / 0 |
| `node tests/studyroom-browser.mjs` | 0 | 13 / 0 |
| `node tests/ui-browser.mjs` | 0 | 38 / 0 |
| `node tests/course-migration.mjs` | 0 | 1 리허설 / 0 |

- `hours can create a future term without switching the operating term or widening student access`는 2027-1 신규 생성·전달, 2026-2 운영 학기와 리비전 유지, 시수배당 전환 후 수신, 잘못된 학기·다른 학기 학생·교사 요청 거부, 운영 학기와 리비전 쓰기 가드를 확인한다.
- `courseTransfer counts use the requested term and default to the operating term`은 지정·생략 학기 조회, 잘못된 학기와 교사 요청 거부, 기존 전체 전송 조회 범위를 확인한다.
- `section assignment defaults to allocation term and shows only a differing operating term`은 시수배당 기본 학기와 운영 학기 차이 표시를 확인한다. 전환 창은 1440px와 390px에서 확인했다.
- `selected section assignment term persists across menus and restricts student preview`는 2027-1 선택 유지, 학생 미리보기 비활성화와 이유를 확인한다.
- `section assignment uses the selected term for counts and hours, and locks switching while working`은 2027-1 분반 수 조회와 전송, 시수배당 학기가 다를 때 안내, 계산·전송 중 전환 차단을 확인한다.
- `section assignment resets on refresh and logout and falls back for unavailable allocation`은 새로고침·로그아웃 시 선택 초기화, 시수배당을 읽지 못할 때 운영 학기 사용을 확인한다.
- Wrangler 검증은 `tests/wrangler.mjs`의 시험 코드를 `node --input-type=module`로 실행하면서 자식 Wrangler 명령에 시험 전용 빈 `--env-file`을 지정했다. 새 로컬 D1 마이그레이션, 배포 건식 실행, 로컬 Worker 라우팅이 통과했다.
- 솔버 시험은 로그인 시 분반배정이 보내는 관리자 `/term` GET을 최대 한 건 허용한다. 나머지는 기존 관리자 `/workspace` GET과 `all: true` 검사를 적용한다.

독립 검토 후에는 분반배정 iframe이 마운트될 때와 표시될 때 호스트의 최신 학기를 사용하게 했다. 학기 확인 중에는 전환·분반 수 조회·시수 전송·학생 미리보기를 잠그고 파일 선택과 계산은 허용한다. 현재 세션의 `AUTH_REQUIRED`는 공통 재로그인 처리로 이어지고 로그아웃 전 요청의 늦은 응답은 호스트에서 버린다. Pages 전송 계층은 실패한 요청에 사용한 세션이 현재 메모리 세션일 때 인증 오류를 반영한다.

- `a slow term lookup leaves admin navigation, file selection and calculation usable`은 `/term`을 지연시켜 관리자 메뉴 이동, 파일 선택, 배정 계산, 학기 의존 기능 잠금과 기본값 반영을 확인한다.
- `delayed section assignment mount and later displays use the latest operating term`은 iframe 모듈을 지연시킨 상태에서 운영 학기를 바꾼 뒤 복귀해 차이 표시와 학생 미리보기 활성 여부를 확인한다.
- `section assignment term authentication failure reopens the shared login`은 동일 출처의 `/term` 인증 오류가 공통 로그인으로 이어지는지 확인한다.
- `a late Pages term AUTH_REQUIRED leaves the new admin session intact`와 `a current Pages term AUTH_REQUIRED clears the session and reopens login`은 교차 출처에서 실제 로컬 세션을 폐기하고 늦은 오류와 현재 오류를 구분하는지 확인한다.
- 학기 전환 스타일은 `assets/section-assignment/view.html`에 유지했다. 기존 `style.css`의 정규화 SHA-256을 검증 계약이 고정한다.

### 분반배정 진급 학기 연계와 정원 상향 · 2026-11-27

- `future student transfers connect only matched promoted students and preserve legacy exact matching`은 다음 학기 생성, 운영 학기와 리비전 유지, 관리자 권한, 과거·잘못된 학기와 3학년 초과 진급 거부, 운영 학기·리비전 가드를 확인한다. 진급 명부에서 학번과 이름을 확인하고 대응 누락·이름 불일치·진급 학년 불일치·명부 없음·명부 이름 불일치를 제외한 뒤 분반을 반영한다. 대응표 누락·중복·형식 오류·연결 0명, 수동 배정 충돌, `TRANSFER_CHANGED`, 자동 백업, 기존 배열 자료의 정확 일치와 전체 반영 차단도 검사한다.
- `section capacities rise only for overcrowded courses and validation rejects excess assignments`는 공통 정원 2에서 신청 5명인 과목의 두 분반에 정원 3을 적용하고 다른 과목은 정원 2를 쓰는지 확인한다. 배정을 바꿔 분반에 4명을 넣으면 검증이 정원 초과를 찾아낸다.
- `promotion counts and future student staging use the target term at 390px`는 2학년 확정 분반 수를 불러오고 공통 정원 35에서 신청 36명을 한 분반에 완전배정한 뒤 학적 학년으로 다음 학기에 저장하는 흐름을 확인한다.
- `promoted hours with a grade prefix import at grade two and export per-section capacities`는 2027-1 시수 전달·JSON의 2학년과 `2A`를 확인하고 실제 시수배당 가져오기를 적용한다. 결과 엑셀은 기존 파서의 학년과 `1A`를 유지하며 엑셀·JSON에 각 분반의 적용 정원이 기록된다. 같은 학년도와 3학년을 넘는 결과의 시수 전달 학년은 기존 브라우저 시나리오에서 확인한다.
- `promoted student mapping file, exclusions and keyboard commit at 390px`는 32px·44px 버튼 높이, 파일 입력 초점, CSV 중복 거부, XLSX의 `학번` 열 사용, 제외 목록, 가로 넘침 및 키보드 등록을 확인한다. 미리보기와 등록이 같은 대응표를 보낸다.
- `mixed roster grades leave the hours import target grade unselected`는 시트명이 한 학년이어도 학번의 학적 학년이 섞이면 대상 학년을 비워 두는지 확인한다.

새 학생 전달은 `{sourceTerm, students}`로 저장한다. 기존 배열 자료는 전달 학기를 원본 학기로 읽는다. 진급 연결은 미리보기와 반영의 `transferRef.studentMapping`으로 `{oldNumber, newNumber, name}` 배열을 보내며 대응표는 DB에 저장하지 않는다.

Windows의 Node.js 24.22.1과 Edge, Miniflare 로컬 D1 및 가상 자료로 확인했다. pnpm이 PATH에 없어 `test:all`의 10개 스크립트를 구성하는 Node 명령 14개를 순서대로 직접 실행했다. Worker 시험 래퍼는 `tests/wrangler.mjs`를 실행하며 세 Wrangler 자식 명령에 시험 전용 빈 `--env-file`을 전달했다. 공유 UI는 38개 화면 점검, 이관은 리허설 1건으로 집계했다.

| 실행 명령 | 종료 코드 | 통과 | 실패 |
| --- | ---: | ---: | ---: |
| `node --test --test-concurrency=1 tests/*.test.mjs modules/allocation/tests/*.test.mjs` | 0 | 193 | 0 |
| `node tests/browser.mjs` | 0 | 16 | 0 |
| `node tests/solver-browser.mjs` | 0 | 1 | 0 |
| `node tests/browser-solver.mjs` | 0 | 1 | 0 |
| `node modules/allocation/tests/browser.mjs` | 0 | 10 | 0 |
| `node modules/allocation/tests/term-switch-browser.mjs` | 0 | 6 | 0 |
| `node tests/section-assignment-browser.mjs` | 0 | 12 | 0 |
| `node tests/pages-browser.mjs` | 0 | 12 | 0 |
| `node test-results/section-promotion-verification/run.mjs --wrangler` | 0 | 3 | 0 |
| `node tests/teacher-tools-browser.mjs` | 0 | 9 | 0 |
| `node tests/allocation-browser.mjs` | 0 | 23 | 0 |
| `node tests/studyroom-browser.mjs` | 0 | 13 | 0 |
| `node tests/ui-browser.mjs` | 0 | 38 화면 점검 | 0 |
| `node tests/course-migration.mjs` | 0 | 1 리허설 | 0 |

앞선 집중 시험 `node --test --test-concurrency=1 tests/api.test.mjs tests/section-assignment.test.mjs`는 종료 코드 0으로 27건이 통과했다. 첫 `node tests/section-assignment-browser.mjs` 실행은 진급 확인 뒤 종전 운영 학기로 돌아가지 않아 마지막 학생 로그인 검증에서 실패했다(종료 코드 1, 통과 10건, 실패 1건). 시험에서 기존 학기로 복귀시킨 뒤 전체 실행에서 분반배정 12건이 통과했다.

`test-results/section-promotion-verification/`에 최초 구현의 명령별 로그가 있다. Edge에서 1440px 파일 선택과 390px 제외 목록을 확인했다. Impeccable 탐지기는 종료 코드 0이었으며, 소스에서 배포용 CSS 경로를 해석하지 못한 부분은 브라우저 렌더링과 공유 UI 시험으로 확인했다. 운영 환경과 실제 모바일 기기는 미검증이다.

#### 독립 검토 반영

- `legacy grade inference fingerprint and settings restore independently of roster grade`는 학년 열이 없는 `2학년` 시트의 `10101`을 사용한다. 기존 파서와 같은 지문으로 받은 schema 3 설정을 복원하고, 그 파일의 학생 전달에는 학적 1학년을, 2027-1 시수 전달에는 대상 2학년을 사용한다. 기존 엑셀 명단에는 파서 학년 2가 남고, 혼합 학년 시수 자료는 대상 학년을 비운다.
- `a slow term lookup leaves admin navigation, file selection and calculation usable`은 시수배당 학기 응답 전 파일 선택·계산·결과 엑셀을 허용하고 시수 JSON을 잠근다. 응답 후 받은 JSON의 대상 학년 3을 확인한다.
- `promoted split and coupled hours references match exported time blocks`는 시수 전달과 내려받은 JSON에서 `2A1`·`2A2` 결합 코드와 분반·결합의 `2A` 참조가 시간블록 목록과 일치하는지 확인한다.
- `a coupled section warns when its partner limits the raised capacity`는 공통 정원 5에서 8명·2명 두 과목을 공통 1학점 과목과 결합한다. 8명 과목의 상향과 결합 적용 정원 5 제한 경고, 미배정 3명 및 제약 검증 통과를 확인한다. `raised coupled capacities keep both groups intact in parallel big sections`는 두 8명 집단과 공통 1학점의 대분반 두 개를 한 블록에 완전배정하고 동시 분반 상한과 동일 학생 구성을 확인한다.
- `mapping rejects file and row limits while reading sparse workbook values`는 5MB 초과, 3,001개 데이터 행을 거부하고 65,001행에 떨어져 있는 실제 두 번째 엑셀 자료를 읽는다. 미래 학생 연결 API 시험은 대응표의 3,000행 수락과 미리보기·등록의 3,001행 거부를 확인한다.

검토 반영 후 Windows Node.js 24.22.1, Edge, Miniflare 로컬 D1에서 `test:all`의 10개 스크립트를 구성하는 14개 명령을 재실행했다. 전체 명령은 종료 코드 0이며 검증 343건이 통과했다.

작업 트리에 `.dev.vars`가 있어 Wrangler의 기본 로드를 피했다. 표의 래퍼가 기존 `tests/wrangler.mjs`를 실행하고 세 Wrangler 자식 명령에 시험 전용 빈 `--env-file`만 추가한다. 로컬 D1 마이그레이션, 배포 건식 실행, 로컬 라우팅 단언을 실행했다.

| 실행 명령 | 종료 코드 | 통과 | 실패 |
| --- | ---: | ---: | ---: |
| `node --test --test-concurrency=1 tests/*.test.mjs modules/allocation/tests/*.test.mjs` | 0 | 195 | 0 |
| `node tests/browser.mjs` | 0 | 16 | 0 |
| `node tests/solver-browser.mjs` | 0 | 1 | 0 |
| `node tests/browser-solver.mjs` | 0 | 1 | 0 |
| `node modules/allocation/tests/browser.mjs` | 0 | 10 | 0 |
| `node modules/allocation/tests/term-switch-browser.mjs` | 0 | 6 | 0 |
| `node tests/section-assignment-browser.mjs` | 0 | 15 | 0 |
| `node tests/pages-browser.mjs` | 0 | 12 | 0 |
| `node test-results/section-promotion-verification/review-fixes/run.mjs --wrangler` | 0 | 3 | 0 |
| `node tests/teacher-tools-browser.mjs` | 0 | 9 | 0 |
| `node tests/allocation-browser.mjs` | 0 | 23 | 0 |
| `node tests/studyroom-browser.mjs` | 0 | 13 | 0 |
| `node tests/ui-browser.mjs` | 0 | 38 화면 점검 | 0 |
| `node tests/course-migration.mjs` | 0 | 1 리허설 | 0 |

집중 시험 `node --test --test-concurrency=1 tests/api.test.mjs tests/section-assignment.test.mjs`는 종료 코드 0으로 29건, `node tests/section-assignment-browser.mjs`는 종료 코드 0으로 15건이 통과했다. HEAD 파서를 불러온 `node test-results/section-promotion-verification/review-fixes/head-fingerprint.mjs`도 종료 코드 0으로 기존 지문과 내려받은 schema 3의 지문 1건이 일치했다. Impeccable 수동 탐지와 `git diff --check`는 종료 코드 0이었다. 탐지기가 소스의 배포용 CSS 경로를 해석하지 못한 부분은 Edge 390px 렌더와 공유 UI 시험으로 확인했다. `hours-import.js`와 분반배정 `style.css`의 차이 검사는 종료 코드 0이었다.

명령별 로그는 `test-results/section-promotion-verification/review-fixes/`에 있다.

#### 후속 독립 검토 반영

- `promoted code collisions stop JSON downloads and hours transfers`는 같은 학생의 두 과목이 `1A`와 `2A`에 완전배정된 엑셀을 확인한다. 진급 변환으로 두 코드가 `2A`에서 겹치면 시트명과 원본 코드 둘을 표시하며 JSON 다운로드와 시수 서버 요청을 중단한다. 기존 비충돌 시간블록·분반·결합 변환도 브라우저 시험에서 확인한다.
- `coupled hours JSON and result workbook record the paired section capacity`는 공통 정원 5에서 각각 12명·2분반, 5명·1분반인 2학점 과목 두 개가 공통 1학점 세 분반과 결합하는 사례를 확인한다. 17명을 완전배정한 뒤 5명 과목과 짝인 공통 분반의 적용 정원 5를 시수 JSON과 엑셀에서 확인한다. 시수 JSON에서 공통 분반 세 개의 적용 정원은 5·6·6이다.
- `a coupled section warns when its partner limits the raised capacity`는 결과 후보의 결합 링크를 사용한 출력용 정원도 엔진에서 적용한 값과 일치하는지 확인한다.

집중 시험 `node --test --test-concurrency=1 tests/api.test.mjs tests/section-assignment.test.mjs`는 종료 코드 0, 29건 통과, 실패 0건이었다. 이어서 직접 실행한 `node tests/section-assignment-browser.mjs`는 종료 코드 0, 17건 통과, 실패 0건이었다.

이후 Windows Node.js 24.22.1과 Edge에서 `test:all`의 10개 스크립트를 구성하는 14개 명령을 다시 실행했다. 모두 종료 코드 0으로 검증 345건이 통과했다. Wrangler 래퍼는 `.dev.vars` 로드를 피하기 위해 기존 `tests/wrangler.mjs`의 자식 명령에 시험 전용 빈 `--env-file`만 추가했다.

| 실행 명령 | 종료 코드 | 통과 | 실패 |
| --- | ---: | ---: | ---: |
| `node --test --test-concurrency=1 tests/*.test.mjs modules/allocation/tests/*.test.mjs` | 0 | 195 | 0 |
| `node tests/browser.mjs` | 0 | 16 | 0 |
| `node tests/solver-browser.mjs` | 0 | 1 | 0 |
| `node tests/browser-solver.mjs` | 0 | 1 | 0 |
| `node modules/allocation/tests/browser.mjs` | 0 | 10 | 0 |
| `node modules/allocation/tests/term-switch-browser.mjs` | 0 | 6 | 0 |
| `node tests/section-assignment-browser.mjs` | 0 | 17 | 0 |
| `node tests/pages-browser.mjs` | 0 | 12 | 0 |
| `node test-results/section-promotion-verification/final-review/run.mjs --wrangler` | 0 | 3 | 0 |
| `node tests/teacher-tools-browser.mjs` | 0 | 9 | 0 |
| `node tests/allocation-browser.mjs` | 0 | 23 | 0 |
| `node tests/studyroom-browser.mjs` | 0 | 13 | 0 |
| `node tests/ui-browser.mjs` | 0 | 38 화면 점검 | 0 |
| `node tests/course-migration.mjs` | 0 | 1 리허설 | 0 |

`git diff --check`와 고정 파일 `hours-import.js`, `style.css`의 차이 검사는 종료 코드 0이었다. 명령별 로그는 `test-results/section-promotion-verification/final-review/`에 있다.

## 기능·보안 시나리오

- 익명 설정 조회·학생 한 명 조회, 전체 학생/다른 학생 미노출, 교사/관리자 접근 경계, 다른 출처·출처 없는 변경 거부, API no-store.
- HttpOnly·Secure·SameSite=Strict 쿠키 실동작, 비밀번호 계산, 로그인 실패 시 이전 세션 폐기, IP 시도 제한, 로그아웃, 교사/관리자 비밀번호 변경 후 기존 세션 거부, 초기화 재접근에도 변경된 비밀번호 유지.
- 학생 한 명 수정 시 다른 학생 행 불변, 반·번호 수정에도 ID/원본학번 유지, 학생 추가·휴학·전출과 조회/명렬표 제외, 분반 코드 변경과 관련 학생 배정 유지.
- 관리자만 운영 학기의 학생 한 명과 수강 배정을 삭제할 수 있다. 교사·비인증 요청은 401, 없는 학생은 404, 학기·리비전 충돌은 409다. 삭제 전 학생과 수강 배정을 변경 이력에 남기고 학생 리비전을 올린다. 다른 학생과 학기 자료, 스터디룸 연결·이용 설정·출석·이력은 보존한다. 같은 학기·ID의 학생이 복원되면 기존 출석의 `person_id`에 다시 연결된다.
- 학생 수정 창의 삭제 버튼을 누르면 학번·이름·학적·수강 과목 수를 표시한다. 취소하면 수정 창의 입력값과 초점이 유지된다. 확인하면 학생이 목록에서 빠지고 현재 필터와 유효한 페이지가 유지된다. 키보드 조작과 390px 가로 넘침·버튼 높이를 검증한다.
- 교실·축약명·학생 웹 수정값과 학적을 보호하는 재등록, 전체교사시간표 단독 교체 시 학생 자료 불변, 5개 XLSX의 실제 브라우저 업로드·미리보기·등록, 3학년 2/3단위 병합·동일 과목 충돌 감지.
- 수동 수업 연결, 시간블록 저장, 2+1수업의 3개 교시·공강, 학기 전환 후 빈 새 학기, 이전 학기 복귀, 오래된 저장의 충돌 거부.
- 다른 관리자의 학기 전환 시 기존 화면의 요청 거부·새 학기 목록 갱신, 교사/관리자 캐시 버전 검증, 다른 화면 메타가 관리자 캐시의 학기를 바꾸지 않도록 분리.
- 백업 메타 한 건/백업, 다운로드와 원본 동일, 복원 전 자동 백업, v1 복원·재백업의 건수/시간표/명렬표/ID/수정 보호 해시 대조, 잘못된 백업의 자료·백업·이력 롤백.
- 동시 저장은 하나만 성공하고 다른 요청은 409, 학생 변경과 감사 이력이 함께 저장됨. 저장 뒤 다른 변경이 이어진 경우 새 버전으로 잘못 표시된 옛 패치를 반환하지 않고 `SAVED_REFRESH_REQUIRED`로 재확인을 요구함.
- 390px 모바일 화면의 가로 넘침 없음·세로 압축 7교시, 실제 PNG 시그니처·다운로드, 일반·명렬표 인쇄, 학생 5명의 A4 4분할 첫 장 4명/둘째 장 1명 구성.
- 로딩 중 새로 생성된 컨트롤까지 비활성·inert, 충돌 오류 후 잠금 해제와 폼 값 보존, 탭·자료 로딩 뒤 미저장 설정 보존, 로그아웃 시 초안과 보호된 시간표 제거.
- `/api`, `/api/missing`, HTML처럼 보이는 API 주소가 404 JSON이며 정적 HTML로 바뀌지 않음. src/tests/migrations/.dev.vars/테스트 SQL 경로가 정적 배포에 노출되지 않음.

자동 인쇄는 window.print 호출과 인쇄 CSS/레이아웃·페이지 구성을 확인했습니다. 실제 OS 인쇄 대화상자·물리 프린터 출력을 수행한 것은 아닙니다. 모바일·관리자·인쇄 PNG를 육안으로 확인했습니다.

## 성능 측정

가상 학생 900명, 분반 288개, 수강 배정 7,200개, 교사 120명. 각각 10회, 로컬 wall time. 로그인은 클라이언트 PBKDF2 포함 1회 44.28ms입니다. 초기 부트스트랩은 설정만, 관리자 목록은 900명 요약만 반환합니다.

| 동작 | 중앙값 ms | p95 ms | 응답 bytes | D1 읽기 행 | D1 쓰기 행 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 초기 bootstrap | 6.75 | 7.22 | 557 | 3 | 0 |
| 학생 시간표 | 36.74 | 58.68 | 4,510 | 549 | 3 |
| 교사 시간표 | 36.45 | 38.72 | 6,625 | 1,465 | 0 |
| 관리자 학생 요약 | 18.64 | 32.95 | 123,914 | 9,935 | 0 |
| 선택분반 명렬표 | 11.38 | 23.89 | 2,487 | 97 | 0 |
| 학생 한 명 저장 | 18.49 | 20.70 | 1,273 | 1,273 | 60 |

학생 조회의 쓰기는 조회 제한 카운터입니다. 저장의 행 사용량에는 배정 인덱스·감사 이력·버전·가드도 포함됩니다. 학생 조회는 필요한 학생·배정만 가져오지만 시간표 계산을 위한 분반·교사 배치는 읽습니다. 학생 저장 응답은 전체 학생 자료를 다시 보내지 않습니다.

초기 측정에서 관리자 목록의 상관 집계가 약 648만 행을 읽어 약 569ms가 걸렸습니다. 학생별 배정을 부분 인덱스로 한 번 집계하는 방식으로 수정했으며 벤치마크에 읽기 행 회귀 상한 검사를 넣었습니다.

이 수치는 Cloudflare 원격 지연·무료 CPU 제한·실제 학교 자료·실사용 동시 접속을 측정하지 않습니다. 무료 운영 가능 여부와 실제 원격 CPU는 배포 후 확인해야 합니다. Apps Script의 기존 시험 결과를 Workers 시험으로 간주하지 않았습니다.

원시 결과는 Git 제외 `test-results/benchmark.json`, `api-metrics.json`, `browser.json`, `wrangler.json`입니다. 가상 화면과 PNG·인쇄 캡처도 같은 폴더에 있습니다. 재현은 README 명령을 따릅니다.

## 사용자에게 남은 설정

1. 배포 서비스에 로그인하여 초기 교사·관리자 비밀번호 변경.
2. 기존 운영 백업 또는 엑셀로 실제 자료 이관 및 compare:backups 대조.
3. 자동 배포를 사용할 경우 Cloudflare Settings → Builds에서 GitHub 저장소를 연결. 현재 OAuth의 Builds API 권한이 없어 이 연결은 수행하지 않았습니다.
4. 기존 GitHub Pages를 보존할 게시 브랜치를 확정한 뒤 필요하면 운영 브랜치 병합.

Worker·D1·Secret 등록과 원격 배포는 완료했습니다. 운영 학생 자료 이관과 GitHub↔Cloudflare 자동 배포 연결은 완료했다고 보고하지 않습니다.

## 관리자 학생 삭제 실행 결과 · 2026-11-26

- `admin student deletion is term-scoped, guarded, audited, and preserves studyroom identity`는 운영 학기의 학생·수강 배정 삭제, 다른 학생과 다른 학기 보존, 전체 삭제 전 값과 `null` 삭제 후 값, 학생 리비전 증가, 401·404·409 거부를 검증한다. 스터디룸의 다섯 테이블을 삭제 전후에 비교하고 같은 학기·ID의 학생을 백업에서 복원해 기존 `person_id`와 출석이 보존되는지 확인한다.
- `admin student deletion confirms by keyboard, preserves cancel drafts, filters and page at 390px`는 추가 창과 수정 창의 버튼 노출, 확인 창의 학생 정보, 취소·Escape 시 요청 없음과 수정값·초점 유지, 확인 후 목록·필터·페이지·초점·알림, 390px에서의 가로 넘침과 버튼 높이를 검증한다.
- `student deletion refreshes concurrent additions and class filters on the current page`는 다른 관리자 세션에서 추가한 학생과 학급이 삭제 응답의 리비전에 맞춰 표시되는지 검증한다. 현재 검색어와 필터, 유효한 페이지를 유지하며 선택 학급의 마지막 학생을 삭제해도 해당 필터가 유지되는지 확인한다.
- `student deletion recovers committed writes after 400, 409 and lost responses`는 삭제를 실제 로컬 D1에 커밋한 뒤 브라우저에 400·409·연결 실패를 돌려준다. 학생 상세 404를 확인해 완료 처리하고 목록을 다시 불러오며 새 학생, 검색어·필터·페이지, 검색 칸 초점을 확인한다. 목록 조회도 실패하면 삭제된 행을 제거하고 새로고침을 안내한다.
- `student deletion preserves a real conflict and shows an unverified result at 390x240`는 다른 관리자의 선행 수정으로 실제 409를 발생시킨다. 409·404의 다시 열기 안내, 상태를 확인하지 못했을 때 새로고침 안내와 확인 버튼 숨김, 390×240 화면의 오류 초점과 수정 입력 보존을 확인한다.
- `closing student edit by Escape or Cancel restores focus to the name button`은 두 방식으로 수정 창을 닫았을 때 이름 버튼으로 초점이 돌아오는지 확인한다. 버튼이 없는 행에서 수정 창을 열고 닫아도 예외가 발생하지 않아야 한다.
- `student deletion reloads a changed operating term and retains the previous draft`는 수정 중 실제 운영 학기를 바꿔 삭제 요청에서 `TERM_CHANGED`를 받는다. 두 모달이 닫히고 새 학기 목록이 로드되며 기존 학기로 돌아갔을 때 학생과 초안이 남는지 확인한다.

Windows의 Node.js 24.22.1과 가상 자료를 사용했다. 실행 환경에 pnpm이 없어 `package.json`의 `test:all` 구성 명령 14개를 이 저장소에서 직접 실행했다. 첫 구현 검증에서 공통 CSS 해시 검사 1건이 실패해 고정 CSS를 복원한 뒤 전체를 재실행했다.

1차 재검토 검증에서 시수배당 학기 전환 시험이 학교 설정 폼을 기다리다 30초 시간 초과로 종료 코드 1을 반환했다. 같은 작업 트리에서 해당 명령을 단독 재실행해 종료 코드 0으로 6개 항목을 통과했다. 두 기록은 `test-results/student-delete-review-verification-final/`에 있다.

2차 재검토 수정 후에는 `test:all`의 구성 명령 14개가 모두 종료 코드 0이었다.

| 실행 명령 또는 진입점 | 종료 코드 | 통과 | 실패 |
| --- | ---: | ---: | ---: |
| `node --test --test-concurrency=1 tests/*.test.mjs modules/allocation/tests/*.test.mjs` | 0 | 191 | 0 |
| `node tests/browser.mjs` | 0 | 16 | 0 |
| `node tests/solver-browser.mjs` | 0 | 1 | 0 |
| `node tests/browser-solver.mjs` | 0 | 1 | 0 |
| `node modules/allocation/tests/browser.mjs` | 0 | 10 | 0 |
| `node modules/allocation/tests/term-switch-browser.mjs` | 0 | 6 | 0 |
| `node tests/section-assignment-browser.mjs` | 0 | 8 | 0 |
| `node tests/pages-browser.mjs` | 0 | 12 | 0 |
| `tests/wrangler.mjs` | 0 | 3 | 0 |
| `node tests/teacher-tools-browser.mjs` | 0 | 9 | 0 |
| `node tests/allocation-browser.mjs` | 0 | 23 | 0 |
| `node tests/studyroom-browser.mjs` | 0 | 13 | 0 |
| `node tests/ui-browser.mjs` | 0 | 38 | 0 |
| `node tests/course-migration.mjs` | 0 | 1 | 0 |

브라우저 건수는 스크립트가 출력한 통과 항목 수로 집계했다. 공유 UI는 화면 점검 38건, 이관은 전체 리허설 1건이다. Worker 시험은 `node --input-type=module -e`로 `tests/wrangler.mjs`를 불러와 세 Wrangler 자식 명령에 빈 환경 파일을 `--env-file test-results/student-delete-recovery-verification/empty.env`로 전달했다.

2차 재검토의 실행 목록과 원시 로그는 `test-results/student-delete-recovery-verification/`에 있다. `test-results/student-delete-mobile.png`의 390px 확인 창과 `test-results/student-delete-error-mobile.png`의 390×240 오류 상태를 육안으로 확인했다. 운영 원격 환경과 실제 모바일 기기는 미검증이며 병합 전 재검토가 남아 있다. 삭제 전 학생 정보는 승인 설계에 따라 변경 이력에 남는다.

### CI의 학생 삭제 확인 창 초점 복귀

- Ubuntu CI에서 `tests/browser.mjs:111`의 Escape 후 삭제 버튼 초점 단언이 실패했다. 당시 확인 창은 브라우저의 기본 초점 복귀에 의존했다. 닫힘 이벤트의 정리가 끝나기 전에 다시 열면 같은 ID를 가진 이전 창을 선택할 수도 있었다. [GitHub Actions 실행](https://github.com/cosmicjh/curriculum/actions/runs/45747047981/job/139665526059)
- 확인 창의 닫힘 이벤트는 수정 창이 열려 있고 원래 삭제 버튼이 DOM에 연결된 경우 그 버튼에 초점을 돌려준다. 새로 삽입한 확인 창에 이벤트를 연결한다. 수정 창은 기존에도 닫힘 이벤트에서 이름 버튼에 초점을 돌려준다.
- 브라우저 시험은 동일한 버튼에 최대 3초 안에 초점이 돌아오는지 확인한다. Escape·취소, 확인 창 오류 후 취소, 수정 창 닫힘, 삭제 성공 후 검색 칸 초점을 검사한다.

`node_modules/.bin/playwright.cmd install chromium`은 종료 코드 0으로 기본 Chromium을 로컬 캐시에 설치했다. Windows의 `tests/browser.mjs`가 Edge 채널을 지정하므로, 아래 코드를 저장소에서 표준 입력으로 `node --input-type=module`에 전달해 테스트 프로세스에서만 채널 지정을 제거했다. Chromium Headless Shell 156.0.8078.4를 사용했다.

```js
import {chromium} from 'playwright';
const launch=chromium.launch.bind(chromium);
chromium.launch=({channel,...options})=>launch(options);
await import('./tests/browser.mjs');
```

| 기본 Chromium의 `tests/browser.mjs` | 종료 코드 | 통과 | 실패 |
| --- | ---: | ---: | ---: |
| 수정 전 | 1 | 7 | 1 |
| 수정 후 | 0 | 16 | 0 |

Windows 기본 Chromium에서는 수정 전 Escape 직후의 초점 단언을 지나 다음 확인 창 열기에서 시간 초과가 발생했다. 두 로그는 `test-results/student-delete-focus-verification/chromium-before.log`와 `chromium-after.log`에 있다. 수정 후 Ubuntu CI 결과는 미검증이다.

이 수정 후 Windows에서 `test:all` 구성 명령 14개를 직접 실행했다. 기본 브라우저 시험은 저장소의 Windows 기본값인 Edge로 실행했고 전체 결과는 위 구성 명령 표와 같은 종료 코드와 통과·실패 수였다. Worker 시험은 앞과 같은 방식으로 세 Wrangler 자식 명령에 빈 `--env-file test-results/student-delete-focus-verification/empty.env`를 전달했다. 명령별 기록과 원시 로그는 `test-results/student-delete-focus-verification/`에 있다.

## 미배정 포함 분반배정 결과 전달 · 2026-11-27

- 가상 엑셀로 부분·전체 미배정을 만들고, 기본 차단과 체크박스 활성화 후 JSON 다운로드·시수배당 전송을 확인했다. 파일과 서버 자료의 미배정 표시, 서버 자료 적용, 체크박스 해제 시 후보 복귀, 새로고침 초기화, 데스크톱과 390px 화면의 높이·가로 넘침·키보드 조작을 확인했다.
- 운영 학기 학생 미리보기·등록과 다른 학기 저장에서 미배정 과목과 전체 미배정 학생이 제외됐다. 등록 후 생략한 과목의 기존 분반이 유지됐다. 전송할 학생이 없거나 제약 또는 2+1 결합 검증을 통과하지 못하면 거부됐다.
- 단위·API 시험으로 완전배정 파일 호환, 미배정 누락 수 검증, 두 검증 플래그 검사, 서버 저장본과 `/assignment-hours` 응답의 `complete`·미배정 수 보존을 확인했다.
- Windows Node.js 24.22.1, Edge, 가상 자료와 로컬 D1에서 `test:all` 구성 명령 14개를 직접 실행했다. 각 명령은 종료 코드 0이며 352건이 통과했다. 단위·통합 197건, 분반배정 브라우저 22건, 공유 UI 화면 점검 38건을 포함한다. Worker 시험은 `node tests/wrangler.mjs`의 세 Wrangler 자식 명령에 시험 전용 빈 `--env-file`을 지정했다.
- 명령별 통과·실패 수, 로그와 화면은 `test-results/section-incomplete-verification/`에 있다.

### 독립 검토 반영

- 학생 자료에서 모든 행의 학적과 진급 학년을 먼저 확인하고, 미완성 후보에서는 신청 과목이 있으나 하나도 배정되지 않은 학생만 제외한다. 완전배정에서 신청 과목이 없는 가상 행을 유지해 명부 불일치가 같은 학기 등록을 차단하고, 다른 학기 저장 요청에도 해당 행이 남는 것을 확인했다.
- 정상 결과 카드 렌더 뒤 두 번째 시트의 `validation.ok`를 false로 바꾸거나 2+1 결합 한쪽을 제거했다. 각 경우 두 시수 동작과 두 학생 동작에서 오류가 표시됐고 다운로드와 전달 요청은 발생하지 않았다. 미배정 수 두 필드는 `Number.MAX_SAFE_INTEGER`까지 허용하며, 초과 값은 단위 시험과 API 시험에서 거부됐다.
- 집중 단위·API 시험은 종료 코드 0으로 41건, 분반배정 브라우저 시험은 종료 코드 0으로 25건이 통과했다. 이어 `test:all`의 구성 명령 14개를 재실행해 모두 종료 코드 0으로 355건이 통과했다. 세 Wrangler 자식 호출에는 시험 전용 빈 환경 파일을 지정했다. 재실행 로그와 명령별 집계는 `test-results/section-incomplete-verification/review-fixes/`의 로그와 상위 `worker-report.md`에 있다.

### 재검토 반영

- 신청 과목이 없는 행만 남은 경우에도 미완성 후보의 실제 배정이 0건이면 오류를 표시한다. 실제 배정이 든 학생 자료를 미리 저장한 뒤 2027-1 저장과 2026-2 미리보기를 시도했다. 두 동작 모두 `보낼 학생 배정이 없습니다.`를 표시했고 `stageToolTransfer` 요청 없이 두 학기의 전달 ID와 내용을 보존했다. 완전배정의 학생 배열은 기존 회귀 시험으로 확인했다.
- 집중 단위·API 시험 41건과 분반배정 브라우저 시험 26건이 종료 코드 0으로 통과했다. 첫 전체 실행은 로컬 D1 API 시험 프로세스에서 멈춰 종료했다. `test:all` 구성 명령 14개를 재실행해 모두 종료 코드 0으로 356건이 통과했다. Wrangler의 자식 호출에는 시험 전용 빈 환경 파일을 지정했다. 명령별 결과는 `test-results/section-incomplete-verification/zero-assignment-fix/rerun/`의 로그와 `test-results/section-incomplete-verification/worker-report.md`에 있다.
