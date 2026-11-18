# Design: 단일 저장소·단일 DB 일원화

Status: Approved by user (2026-11-18)

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

### 운영 이관 절차(별도 승인 후 실행; 이번 작업에서는 도구와 로컬 리허설만)
`scripts/migrate-course-allocation.mjs`(기존 `migrate-class-swap.mjs` 방식 참고):
1. 사전 검사(읽기 전용): 원본 행 수·본문 해시·버전 보고.
2. `--apply`: 시수배당 수정 일시 중단 → 두 DB 전체 SQL과 시수배당 앱 JSON 백업을 Git 제외 `private/`에 저장 →
   새 마이그레이션 적용 → `ca_` 테이블로 복사 → 행 수·본문 SHA-256·버전·ID 집합 대조, 불일치 시 중단.
3. Worker 배포(새 코드가 `ca_` 테이블 사용) → 이전 주소 연결 페이지 게시.
4. `--release`: 수정 재개.
5. 원복 경로: 원본 DB는 수정하지 않고 보존하므로, 배포 이전 버전 재배포 + `COURSE_DB` 사용 코드로 복귀 가능해야 한다.

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
- 원본 DB를 수정하지 않고 복사·대조 후 전환한다. 운영 접근은 별도 승인된 이관 단계에서만 한다.
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
