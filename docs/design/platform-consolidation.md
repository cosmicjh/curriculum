# Design: 단일 저장소·단일 DB 일원화

Status: Approved by user (2026-11-18)
2026-11-18 사용자 승인: 독립 검토 반영 이관 순서 갱신
2026-11-18 사용자 결정: 공통 DB 전체 SQL은 Time Travel 복구 지점과 ca_ 스냅샷으로 대체한다.
2026-11-18 사용자 결정: 원본 DB의 쓰기는 업무·인증 테이블 동결 트리거로 차단한다. 일부 동결을 복구하면 전체를 새 세대로 교체한다. 해제 검증 중과 해제 뒤 원본 동결 제거는 금지한다.

## Objective and scope

흩어진 모듈·저장소·DB·배포를 `cosmicjh/curriculum` 저장소 하나와 `school-timetable-db` 하나, Worker `school-timetable` 하나로 일원화한다.
이번 작업 범위는 통합 구현·로컬 이관 리허설·독립 검토까지다. 운영 DB 이관·배포·주소 전환·자원 정리는 결과 보고 후 별도 사용자 승인으로 진행한다.

## Current system and constraints (2026-11-18 조사)

| 자원 | 현황 |
| --- | --- |
| `cosmicjh/curriculum` (이 저장소) | 시간표·결보강·스터디룸·분반배정·브라우저 솔버·시수배당(vendor 복사본). Worker `school-timetable`, GitHub Pages `/curriculum`, Cloudflare Builds |
| `cosmicjh/course-allocation` | 시수배당 원본(app/·shared/·server/·functions/·migrations/), 로컬 Python 솔버 `timetable-solver/`, 테스트·문서·AGENTS/CLAUDE. Cloudflare Pages `course-allocation` + GitHub Pages `/course-allocation` |
| `cosmicjh/timetable` | curriculum 이전 판. Pages 404, 저장소 미보관 |
| `cosmicjh/cheomdancs` | 이전 결보강. GitHub Pages에 이전 화면 공개 중 |
| Worker `class-swap` | `/curriculum/#/teacher`로 302. 설정은 이 저장소 `wrangler.class-swap-redirect.jsonc` |
| Apps Script 스터디룸 | 인쇄된 QR 진입점(배포 v12). 이 저장소 `apps-script-bridge/`(README 미추적) |
| D1 `school-timetable-db` | 주 DB |
| D1 `course-allocation-db` | 시수배당. Pages(`DB`)와 Worker(`COURSE_DB`) 공동 사용 |
| D1 `class-swap-db` | 이관 완료된 읽기 전용 복구 원본(연결 해제) |
| D1 `school-timetable-studyroom-test-20261106` | 시험 잔여 DB |

문제:
- 시수배당 서버 코드가 두 벌이다: `course-allocation/server/api.js`(공용 접속·관리자 비밀번호, 자체 세션)와
  `vendor/course-allocation/server/api.js`(플랫폼 역할). 이미 서로 다르며 같은 DB를 두 경로로 수정한다.
- 서비스 간 순환 의존: 독립 API는 `school-timetable`의 `/api/courseAllocationPolicy`를 HTTP로 호출하고,
  Worker는 동기화 스크립트로 시수배당 화면을 복사한다.
- 동일 기능의 인증 방식이 두 가지다.
- 로컬 폴더 `course-allocation/class-swap-cloudflare/`, `course-allocation/studyroom_codex_handoff/`는 Git 저장소가 아닌 인계 자료이며 비공개 자료를 포함한다.

## Data structure and flow

### 저장소 구성(목표)
- `cosmicjh/curriculum`이 유일한 소스 저장소다. course-allocation 이력을 보존해 들여온다(`git subtree` 또는 동등한 이력 보존 방식).
- 시수배당 모듈: `modules/allocation/`(화면 소스 app/, 업무 규칙 shared/, 서버 처리, 시험·픽스처). 정확한 하위 배치는 구현자가 정한다.
- `timetable-solver/`(Python 로컬 솔버)는 저장소 루트로 옮긴다. 솔버 공유 모듈(timetable-model/cpsat/checker)은 단일 원본만 둔다.
- `vendor/course-allocation/`, `scripts/sync-course-allocation.mjs`, `scripts/course-allocation-transport.js`는 제거하고 원본에서 직접 빌드한다.
- 공통 UI `ui.css`는 플랫폼 공통 자산 한 곳에 둔다(기존 승인 설계 `ui-unification-optimization.md`의 단일 원본 원칙 유지).
- course-allocation의 `AGENTS.md`·`CLAUDE.md` 협업·보안 규칙을 이 저장소 루트로 옮기고 구조 설명을 갱신한다.

### DB(목표)
- `school-timetable-db` 하나. 시수배당 테이블은 `ca_` 접두어로 둔다(`credentials`·`sessions`·`login_limits`·`write_guards` 이름 충돌 회피):
  workspace, sheets, entity_ids, operations, write_guards, term_archives 등 업무 테이블과 그 트리거·제약·인덱스.
- 시수배당 자체 인증 테이블(credentials, sessions, login_limits)은 옮기지 않는다. 플랫폼 교사·관리자 세션과 기존 정책(시수배당 사용 허용, 학기)을 그대로 쓴다.
- 보존: workspace/sheets JSON 본문, ID, revision·globalRevision, operationId 멱등성, identity_hash, 이력 200개, 백업 schemaVersion 1, term_archives.
- `COURSE_DB` 바인딩은 이관 검증 후 제거한다.

### 인증·배포(목표)
- 시수배당 수정은 플랫폼 교사·관리자 권한으로만 가능하다. 기존 권한 의미를 유지한다: 교사는 입력과 제출(draft→submitted),
  관리자는 과목·분반 구조 변경, 확정(submitted→locked), 재개(→draft)까지. 공용 접속 비밀번호 로그인과 독립 관리자 비밀번호는 폐지한다.
- 정책 확인은 Worker 내부 함수 호출로 바꾼다(HTTP 자기 호출 제거).
- 배포: Worker `school-timetable` + GitHub Pages `/curriculum`.
- 이전 주소: GitHub Pages `/course-allocation`, Cloudflare Pages `course-allocation.pages.dev`, GitHub Pages `/cheomdancs`는 통합 화면의 해당 메뉴로 안내하는 정적 연결 페이지만 남긴다.
  Worker `class-swap`(302)과 Apps Script QR 진입점은 인쇄 QR·이전 주소 보존을 위해 유지한다.

### 운영 이관 절차(별도 승인 후 실행, 이번 작업은 로컬 리허설)
`scripts/migrate-course-allocation.mjs`와 [운영 이관·원복](../COURSE_ALLOCATION_MIGRATION.md)을 따른다.

1. 이전 Pages API와 기존 Worker의 원본 DB 쓰기 경로를 차단하고 진행 중인 요청을 소진한다. 원본 업무·인증 테이블에 INSERT·UPDATE·DELETE를 거부하는 동결 트리거를 설치하고 정의 및 쓰기 거부를 확인한다. Builds의 main 자동 배포는 이관 해제가 끝날 때까지 유예한다.
2. 공통 DB에 `ca_` 스키마를 적용하고, 전환 플래그·Worker 버전 식별자·임시 읽기 전용 사용 목적의 `COURSE_DB` 바인딩을 갖춘 이관 Worker를 수동 배포한다. 이 Worker는 시수배당 수정만 잠그며 다른 모듈은 공통 DB를 계속 사용한다.
3. 읽기 전용 사전 검사로 원본 행 수·본문 해시·버전을 확인한다. 원본 DB 전체 SQL과 앱 JSON을 Git 제외 `private/`에 보관한다. 공통 DB의 전체 SQL 백업은 서비스 중단 가능성 때문에 Time Travel 복구 지점(bookmark)으로 대체한다. 복사 직전 대상 `ca_` 업무 테이블이 비어 있음을 기록한다. 관리자 전용 Worker 내부 경로에서 바인딩 매개변수·D1 batch로 페이지별 복사하고 원본과 대조한다. 대상의 대조 스냅샷과 해시는 `private/`에 보관한다.
4. 예상 Worker 배포 버전과 읽기 전용 HTTP 확인을 거친다. 같은 원본 동결 상태를 확인하며 원본과 대상을 마지막으로 처음부터 전체 재스캔하고 해시를 대조한 뒤 대상 쓰기를 해제한다. 원본은 동결 상태로 보존하며 삭제는 30일 뒤 별도 승인 대상이다.
5. 해제 후 main에 병합하고 정상 Builds에서 같은 기능이 배포되며 전환 플래그와 `COURSE_DB` 바인딩이 제거됐는지 확인한다. 이전 주소를 연결 페이지로 게시한다.
6. 해제 검증이 시작되기 전 원복할 때는 대상 DB에서 원복을 예약하고 원본 동결 트리거를 제거해 기존 쓰기를 재개할 수 있다. 해제 뒤 원본 편집 재개는 별도 사용자 승인을 거친다. 다음 이관은 원본을 새로 동결하고 해제 전 대상 `ca_`의 백업을 남긴 후 미해제 이관분만 원자적으로 정리한다. 후속 원본 저장을 보존해 다음 이관을 할 수 있다. Time Travel은 공통 DB 전체를 되돌릴 수 있으므로 다른 모듈 변경에 대한 영향 확인과 별도 승인을 거친 경우에만 사용한다. 해제 후에는 양쪽 쓰기를 멈추고 새 `ca_` 수정과 전달 이력을 대조한다.

## Selected approach and rationale

- curriculum을 기준으로: 운영 Worker·DB·GitHub Pages·Builds 연결·주소가 그대로다.
- 접두어 테이블: 한 DB 안에서 충돌 없이 원본 스키마·트리거 의미를 그대로 옮길 수 있다.
- 독립 인증 폐지: 서버 코드·인증을 한 벌로 줄인다(사용자 결정).
- 이력 보존 가져오기: 과거 커밋·설계 근거 추적 유지.

## Rejected alternatives

- 새 저장소 생성: 주소·Builds·Pages 재설정 필요(사용자 비선택).
- 독립 화면 유지: 인증 두 방식 유지(사용자 비선택).
- 시수배당 JSON을 기존 시간표 테이블에 섞기: 버전·멱등성·트리거 의미가 깨질 위험.
- 이관 즉시 이전 자원 삭제: 복구 여유 없음(사용자 비선택).

## Compatibility, privacy and migration risks

고위험: DB 마이그레이션, 인증·권한 변경, 학생·교사 업무 자료 이관. 독립 검토 필수.
- 원본 자료 행을 수정하지 않는다(동결 트리거만 추가·제거). 복사·대조 후 전환한다. 운영 접근은 별도 승인된 이관 단계에서만 한다.
- 비공개 자료(`private-data`, `local-private`, `.dev.vars`, 백업)는 커밋하지 않는다. 시험은 가상 자료만 쓴다.
- 보관 자원: 저장소 3개(course-allocation, timetable, cheomdancs)는 GitHub 보관(되돌릴 수 있음), DB는 SQL 백업 후 연결 해제·보존.
  시험 DB는 운영 이관 단계에서 삭제, 나머지는 30일 뒤 다시 승인받아 삭제한다.
- 로컬 인계 폴더 2개는 저장소에 넣지 않는다. 처리(보관 위치 이동 등)는 별도 확인한다.
- Orca·작업 폴더 기준이 `course-allocation`에서 `curriculum` 체크아웃으로 바뀐다.

## Testable acceptance conditions

- 이 저장소에서 기존 curriculum 시험 전체 + 옮겨 온 시수배당 시험(단위·브라우저·인쇄 SVG·가져오기·백업/복원·충돌·재시도) + 솔버 JS 시험 + Python 솔버 시험 통과.
  폐지 기능(공용 접속·독립 관리자 비밀번호) 시험은 제거하고, 대신 플랫폼 권한 경계 시험을 추가한다(교사 입력 가능·구조 변경 거부, 관리자 상태 전환, 비로그인·학생 거부, 정책 미허용 시 거부).
- 로컬 이관 리허설: 가상 시수배당 DB → 로컬 주 DB 이관 전후 시수배당 앱 백업 JSON(내보낸 시각 등 메타 제외)과 행 수·해시·버전 동일. 재실행 시 중복 없이 멱등. 불일치 주입 시 중단.
- 빌드 산출물에 vendor·동기화 스크립트·`COURSE_DB` 의존이 없다(이관 전환 플래그가 필요하면 그 범위만 허용하고 문서화).
- UI 규칙 시험(텍스트 버튼·회색조·Pretendard) 유지.
- 이전 주소 연결 페이지 초안이 준비되어 있다(게시는 운영 단계).
- 검증 계약(`docs/VALIDATION.md`) 통합본에 위 변경을 기록한다(사용자 승인 범위: 독립 인증 폐지에 따른 시험 교체).

## Open questions for user approval

없음. 운영 이관·배포·주소 전환·자원 삭제·로컬 인계 폴더 처리는 단계별로 다시 승인받는다.
