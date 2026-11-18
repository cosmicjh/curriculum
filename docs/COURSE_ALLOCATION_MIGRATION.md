# 시수배당 DB 운영 이관과 원복

[승인 설계](design/platform-consolidation.md)의 2026-11-18 결정에 따른다. 원격 명령, 운영 배포, 연결 페이지 게시는 별도 승인 이후 수행한다.

## 1. 이전 쓰기 중단

- 승인된 후보 커밋, 기존 두 서비스의 배포 버전, GitHub Pages 산출물과 롤백 방법을 기록한다. 이관을 해제하기 전까지 후보를 main에 병합하거나 push하지 않는다. Cloudflare Builds의 프로덕션 브랜치가 main인지, 진행 중이거나 대기 중인 프로덕션 작업이 없는지 확인한다. 앞선 작업의 예약 배포가 있다면 중단되거나 끝날 때까지 수동 배포를 진행하지 않는다.
- 이전 주소와 미리보기·별칭의 화면을 먼저 접근 차단 안내로 전환한다. 가상 입력 없이 접속해 안내를 확인한 뒤 기존 Worker에서 시수배당 `/api/courseWorkspace` 쓰기와 `/api/courseBridge`를 유지보수 상태로 전환한다. 이전 Cloudflare Pages Functions의 `/api/*`를 중단한다. 이전 Pages의 `GET /api/global`은 캐시 없는 HTTP 410과 `X-Course-Allocation-Frozen: 1`을 반환해야 한다. 이전 미리보기·별칭도 확인하고 진행 중인 요청을 소진한다.
- 경로 확인에는 본문과 인증 헤더 없이 `GET`을 사용한다. 원본 `eb75f3c:server/api.js`의 `route`는 `POST /access/login`에서 자격 증명을 확인하기 전에 `limitLogin`과 `credentials(...,true)`를 호출한다. 빈 JSON도 로그인 제한 행이나 초기 인증 행을 쓸 수 있다. 자격 증명 없는 `GET /global`은 비변경 분기에서 인증에 걸리고 저장 경로에 도달하지 않는다. 현재 Worker의 이전 브리지 확인도 `GET /api/courseBridge`를 쓴다.

**사용자 공지 예시:** 시수배당 자료를 통합 주소로 옮기는 중입니다. 이전 주소에서 시수배당을 저장할 수 없습니다. 작업 완료 후 안내된 통합 주소를 이용해 주세요.

이전 배포에서 동결 오류가 일반 로그인·저장 실패로 나타날 수 있다. 원본 자료를 보호하기 위해 DB가 쓰기를 거부한 것이다. 이전 화면에서 재시도하기 전에 차단 안내와 이전 주소 전환 상태를 확인한다. 새 경로는 동결 오류를 간단한 HTTP 503 안내로 표시한다.

이전 쓰기 차단과 요청 소진을 확인한 후 수동 배포로 넘어간다. 원본 DB 동결은 임시 Worker 배포와 검증을 마친 뒤 진행한다.

## 2. 임시 이관 Worker 수동 배포

이전 원본 쓰기가 중단되고 요청이 소진된 뒤에만 실행한다. 공통 DB에 이관 마이그레이션 0012~0016을 적용한 뒤 임시 Worker를 배포한다. 정상 배포 설정에는 `DB` 바인딩만 있다.

```sh
node scripts/migrate-course-allocation.mjs --prepare-config
pnpm db:migrate:remote
pnpm exec wrangler deploy --config wrangler.allocation-migration.local.json
```

생성된 Git 제외 설정에 `COURSE_ALLOCATION_MIGRATION=true`, 임시 `COURSE_DB`, Cloudflare 버전 메타데이터가 있다. 수동 배포의 출력에서 정확한 Version ID를 기록한다. `GET /api/health`의 `courseAllocationMigrationVersion`이 그 ID인지 확인한다. 임시 Worker는 시수배당 쓰기를 잠근다. `GET /api/courseBridge`가 차단 표식과 410을 반환하는지 확인한다. 다른 모듈의 조회·저장을 확인한다. `allocation_schema_required`는 스키마 미적용이고, 정상 Worker의 `allocation_unavailable`은 빈 업무 스키마다.

운영 관리자로 Worker 주소에 로그인한다. 해당 네이티브 관리자 쿠키 한 개를 `COURSE_ALLOCATION_ADMIN_COOKIE` 환경 변수로 안전하게 전달한다. 값은 화면 출력, 명령 인수, 셸 명령 이력, 로그에 남기지 않는다. 아래 `<Version ID>`는 이 단계에서 기록한 Cloudflare 배포 버전이다.

```sh
node scripts/migrate-course-allocation.mjs --remote --expected-version <Version ID> --status
```

이 명령이 예상 배포 버전과 관리자 API의 이관 스키마 조회를 모두 통과해야 원본 동결로 넘어간다. 최초 실행의 상태는 `empty`다. 스키마 적용이나 임시 배포·확인이 실패하면 아래의 동결 전 원복 절차를 따른다.

## 3. 원본 동결, 백업·복사·대조

예상 버전과 관리자 API 상태를 확인한 뒤, 백업·복사 직전에 원본을 동결한다. 도구도 버전과 관리자 이관 상태를 확인한 후 동결 명령을 실행한다.

```sh
node scripts/migrate-course-allocation.mjs --remote --expected-version <Version ID> --freeze-source
node scripts/migrate-course-allocation.mjs --remote --check-source-freeze
```

9개 원본 업무·인증 테이블의 INSERT·UPDATE·DELETE를 거부하는 트리거 27개가 설치된다. `sqlite_schema`에서 전체 정의와 동일한 동결 세대를 확인한다. `INSERT INTO workspace … SELECT … FROM workspace WHERE id=1`이 동결 오류를 내는지도 확인한다. 트리거가 없어도 그 문장은 기존 기본키를 그대로 선택해 중복 오류 또는 0행으로 끝난다. 기존 동결 일부가 없으면 한 D1 배치에서 새 세대로 27개 전부 다시 설치한다. 이전 대조는 무효가 되므로 미해제 대상을 백업·정리한 뒤 원본 전체 검사부터 다시 진행한다.

```sh
node scripts/migrate-course-allocation.mjs --remote --expected-version <Version ID>
node scripts/migrate-course-allocation.mjs --remote --expected-version <Version ID> --apply
```

첫 명령은 원본 업무를 읽어 행 수·전체/테이블 해시·버전을 계산한다. workspace와 활성 시트는 `validateGlobal`을 통과해야 하고, 계산한 시트 ID 집합은 `entity_ids`와 일치해야 한다. 무결성 실패에는 자료 없는 요약만 표시한다. 두 번째 명령은 예상 버전과 이전 쓰기 차단을 다시 확인한다. 무결성 검사까지 통과하면 검증에 쓸 디렉터리를 `private/course-allocation-*/`에 생성한다.

- 원본 `course-allocation-db` 전체 SQL을 내보내고 Worker 페이지를 통해 원본 업무 행과 앱 백업 JSON을 보관한다. SQL 내보내기 동안 원본 DB가 응답하지 않을 수 있으며, 원본은 이미 쓰기가 중단된 상태다.
- 공통 DB에서는 이관 직전의 Time Travel bookmark를 얻어 `target-recovery.json`에 기록한다. 도구는 `wrangler d1 time-travel info DB --json --config wrangler.jsonc`를 쓴다. 이 단계는 읽기 전용이며 공통 DB 전체 SQL 내보내기나 가져오기를 실행하지 않는다.
- 대상 `ca_` 테이블의 빈 상태를 `before.json`에 기록한다. Worker는 관리자 세션을 다시 검사하고 바인딩 매개변수와 D1 batch로 업무 행을 키 순서대로 복사한다. 페이지마다 진행 위치와 해시를 같이 기록한다. 엔터티 인덱스는 삽입 트리거로 재구성한다.
- 원본과 대상을 다시 끝까지 읽어서 전체 해시를 대조하고, 대상 업무 테이블별 JSONL과 `comparison.json`을 저장한다. 중간에 실패하면 쓰기 일시 중지를 유지한다. 동결 세대와 원본 해시가 같을 때 같은 명령으로 이어서 실행할 수 있다. 다른 모듈의 정상 쿼리와 같은 D1에서 짧은 배치로 처리한다.

Wrangler 자식 환경에 `WRANGLER_WRITE_LOGS=false`를 강제한다. 내보내기 stdout·stderr는 버리고, Time Travel 응답은 파일로만 기록한다. 전체 SQL과 시수배당 스냅샷에는 인증 정보 또는 업무 자료가 들어갈 수 있다. Git, 정적 배포, CI 산출물, 공개 로그에 넣지 않는다. 도구의 대조 요약에는 자료 ID를 넣지 않는다. 앱 백업은 schemaVersion 1이며 브라우저 메모리에서 누적된 작업 이력은 포함하지 않는다.

## 4. 쓰기 해제

일반 플랫폼 관리자와 허용된 교사로 로그인하여 교과군 버전·가능한 동작·백업을 확인한다. 두 이전 쓰기 경로에 대한 차단 상태와 요청 소진이 유지되는지 재확인한다.

```sh
node scripts/migrate-course-allocation.mjs --remote --expected-version <Version ID> --release
```

도구는 실제 HTTP로 기대 배포 버전, 이전 Worker 경로의 차단 응답, 이전 Pages의 차단 표식을 확인한다. 해제용 검증은 처음부터 원본과 대상을 전체 재스캔한다. 원본 동결 세대와 트리거 정의를 각 페이지에서 확인하고 마지막에 쓰기 거부를 다시 시험한다. Worker가 짧은 검증 유효 시간 안에 이전 Pages와 동결을 확인한 후 대상 쓰기만 해제한다. 해제 CLI는 반환 전에 원본 동결을 재확인한다. 쓰기를 해제하기 전에 불일치가 나오면 일시 중지를 유지한다. 해제 검증이 시작되면 원복 명령은 거부되며, 원복 예약이 먼저 생기면 해제 검증을 시작할 수 없다. 최종 재스캔부터 해제 완료까지 운영자는 도구 밖에서 원본 DDL을 실행하지 않는다. 보고된 비교 파일을 보관한다. 해제 직후 버전·저장·분반배정 전달을 확인한다.

이전 주소의 응답이 404로 바뀌거나 해제 명령의 응답을 받지 못했다면 상태부터 확인한다. 2단계의 `--status`는 기대 Worker 버전과 관리자 세션으로 대상 DB의 상태를 읽고 이전 주소에 요청하지 않는다. 임시 Worker를 사용할 수 없으면 Wrangler 접근 권한으로 아래 읽기 전용 명령을 사용한다. 두 명령은 상태·단계·원복 예약 여부만 표시한다.

```sh
node scripts/migrate-course-allocation.mjs --remote --db-status
```

`released`면 해제 후 절차를 따른다. `release-check`나 `release-ready`에서 중단했다면, 이전 경로를 복구한 뒤 `--release`로 전체 재검증을 다시 실행하거나 아래 명령으로 진행을 명시적으로 취소한다. 취소에는 관리자 세션이 필요하다. 도구가 현재 진행 토큰을 읽어 제출하고 Worker는 취소와 동시에 토큰을 교체한다. 이전 주소가 404여도 취소할 수 있다.

```sh
node scripts/migrate-course-allocation.mjs --remote --expected-version <Version ID> --cancel-release
```

취소가 확인되면 대상은 쓰기가 잠긴 `paused`와 복사 대조 완료 상태인 `verified`로 돌아간다. 그 상태에서 일반 원복을 진행하거나, 이전 경로 차단 응답이 복구됐을 때 처음부터 해제 검증을 다시 실행할 수 있다. 취소 응답도 유실되면 먼저 상태를 다시 조회한다.

## 5. 정상 배포와 이전 주소

해제 후에만 main에 병합한다. Builds가 승인한 그 커밋을 `wrangler.jsonc`로 배포했는지 빌드·배포 이력에서 확인한다. `/api/health`에서 임시 버전 필드가 사라지고 이관 API가 404이며 배포 바인딩에 `COURSE_DB`와 플래그가 없는지 확인한다. 대시보드의 외부 설정에 전환 플래그가 남지 않게 한다. 정상 UI와 API가 합격한 뒤 승인된 이전 주소 연결 페이지를 게시한다. 이전 Pages API 차단과 원본 동결 트리거를 유지한다. 임시 Worker가 사라진 뒤에는 `node scripts/migrate-course-allocation.mjs --remote --check-source-freeze`로 확인한다. 원본 삭제는 30일 뒤 별도 승인을 받는다.

## 원복

- **동결 전 실패:** 공통 DB 마이그레이션, 임시 배포 또는 버전·관리 API 확인에서 실패하면 원본 트리거는 아직 설치되지 않았다. 기존 Worker 버전과 `COURSE_DB` 경로를 복구하고 기존 경로의 유지보수를 해제한다. 이관 스키마를 되돌리기 위해 공통 DB 전체를 복구할 필요는 없다.
- **동결 후 일반 원복:** 이전 주소의 유지보수를 유지하고 현재 이관 Worker에 관리자로 로그인한다. 예상 배포 버전과 관리자 환경 쿠키를 사용해 `node scripts/migrate-course-allocation.mjs --remote --expected-version <Version ID> --thaw-source`를 실행한다. 대상이 해제 검증 중이거나 해제됐으면 종료 코드 1로 중단된다. 진행 중인 해제는 위의 `--cancel-release`로 취소할 수 있다. 승인된 원복은 공통 DB에서 원복을 예약하고 원본 트리거만 제거한 뒤 예약을 끝낸다. 도중에 연결이 끊기면 같은 명령으로 이어서 확인한다. 성공 확인 뒤 기존 Worker 버전과 `COURSE_DB` 경로를 돌리고 필요하면 이전 Pages 배포를 복구한 다음, 원본 스냅샷을 확인해 유지보수를 해제한다.
- **동결 후 임시 Worker 장애:** 이관 관리 경로가 요청을 받을 수 없게 유지하고 이미 진행 중인 이관·해제 요청을 소진한다. 비상 원복을 마칠 때까지 임시 Worker를 다시 배포하거나 해제 명령을 실행하지 않는다. Wrangler 접근 권한으로 `node scripts/migrate-course-allocation.mjs --remote --emergency-thaw`를 실행한다. 도구는 공통 DB의 이관 상태 테이블만 읽는다. 해제 상태를 확인할 수 없거나 `release-check`, `release-ready`, `released`이면 종료 코드 1로 중단한다. 허용된 경우 원본 트리거를 조회한 뒤 대상 상태를 다시 읽고, 같은 세대임을 원본 D1 배치에서 재확인해 트리거만 제거한다. 이 명령은 대상 DB에 예약을 쓰는 일반 원복과 달리, 이관 관리 경로가 계속 비활성이고 진행 중인 요청이 없다는 운영 조건에 의존한다. 해제 검증 단계에서 장애가 났다면 확인된 임시 버전을 복구한 뒤 관리자 세션으로 취소한다. 비상 원복은 공통 DB를 변경하지 않으므로 기존 일반 원복 예약이 있었다면 다음 이관 때 임시 Worker에서 `--thaw-source`를 재실행해 예약을 끝낸 후 다시 동결한다. 비상 원복 성공 뒤에 기존 쓰기 경로를 복구한다.
- **미해제 이관분 정리:** 이전 쓰기가 다시 차단되고 원본이 새로 동결되며 이관 Worker 버전이 확인되면 `node scripts/migrate-course-allocation.mjs --remote --expected-version <Version ID> --reset-paused`로 대상의 업무 스냅샷을 먼저 보관한다. 이후 백업한 이관 버전과 대상 해시를 확인하고, 같은 트랜잭션에서 `ca_` 업무 행과 이관 표지만 제거한다. 한 번이라도 해제한 이관분에는 이 명령을 사용할 수 없다. 정리 후 기존 원본의 새 저장을 포함한 `--apply`를 다시 진행한다.
- **해제 전 Time Travel 대안:** 공통 DB 차원의 장애 복구가 필요하다면 `target-recovery.json`의 복구 지점을 검토한다. 공통 DB 전체를 되돌리므로 다른 모듈의 변경 손실과 영향에 대한 별도 승인을 받아야 한다. 시수배당 이관만 되돌릴 때는 위 `ca_` 정리를 사용한다.
- **해제 후:** 양쪽 쓰기를 중단하고 원본 동결 스냅샷, 대조 스냅샷, 해제 후 `ca_` 업무 변경·작업 버전·도구 간 전달 기록을 비교한다. 원본 편집 재개가 필요하면 별도로 사용자 승인을 받는다. 현재 이관·원복 도구는 해제 후 원본 동결 제거를 지원하지 않는다. 공통 DB 전체 복구는 이 경로에 적용하지 않는다.

## 로컬 리허설

`node tests/course-migration.mjs`는 독립적인 Miniflare Worker·두 D1과 가상 이전 Pages 응답으로 복사·대조·해제·취소를 검증한다. 이전 경로가 열린 경우 가져온 이력의 실제 원본 핸들러를 호출한다. `node --test tests/course-migration-recovery.test.mjs`는 동결 전 스키마·버전 검증 실패와 임시 Worker 종료 후의 비상 원복을 시험한다. 동결·비상 원복 명령의 로컬 실행에는 같은 격리 `--persist-to`를 준다. `test-results/course-migration-*/comparison.json`과 `commands.json`에 비교와 명령별 종료 코드가 있다. 옵션 없이 실행한 도구는 로컬 읽기 전용 사전 검사로 동작한다. `--url`에는 루프백 주소만 사용하고, Worker 명령에는 `--expected-version`과 가상 관리자 환경 쿠키를 제공한다. 로컬 `--apply`의 `--persist-to`는 실행 중인 이관 Worker의 격리 상태 경로와 같아야 한다. 가상 복구 정보는 실제 Cloudflare bookmark가 아니다.
