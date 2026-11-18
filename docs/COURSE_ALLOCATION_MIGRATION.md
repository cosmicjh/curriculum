# 시수배당 DB 운영 이관과 원복

[승인 설계](design/platform-consolidation.md)의 2026-11-18 결정에 따른다. 원격 명령, 운영 배포, 연결 페이지 게시는 별도 승인 이후 수행한다.

## 1. 이전 쓰기 중단

- 승인된 후보 커밋, 기존 두 서비스의 배포 버전, GitHub Pages 산출물과 롤백 방법을 기록한다. 이관을 해제하기 전까지 후보를 main에 병합하거나 push하지 않는다. Cloudflare Builds의 프로덕션 브랜치가 main인지, 진행 중이거나 대기 중인 프로덕션 작업이 없는지 확인한다. 앞선 작업의 예약 배포가 있다면 중단되거나 끝날 때까지 수동 배포를 진행하지 않는다.
- 기존 Worker에서 시수배당 `/api/courseWorkspace` 쓰기와 `/api/courseBridge`를 유지보수 응답으로 전환한다. 이전 Cloudflare Pages Functions의 `/api/*`를 중단해 예전 GitHub Pages 화면의 쓰기도 차단한다. 이전 Pages의 `PUT /api/global`, `PUT /api/sheets/freeze-probe`, `POST /api/term`, `POST /api/access/login`은 캐시 없는 HTTP 410과 `X-Course-Allocation-Frozen: 1`을 반환해야 한다. 정책 URL만 차단하면 이미 시작된 요청과 로그인 정리 작업을 막지 못한다.
- 각 실제 URL에 빈 JSON으로 요청해서 유지보수 상태와 응답 출처를 확인한다. 이전 두 배포의 요청 로그에서 마지막 원본 쓰기 요청이 끝났는지 확인하고 차단 시각·버전·소진 시각을 기록한다. 기존 쓰기 경로가 계속 열려 있거나 진행 중 요청이 남아 있으면 여기서 중단한다. 시간표·결보강·스터디룸·분반배정은 정상으로 유지한다.

## 2. 임시 이관 Worker 수동 배포

이전 원본 쓰기가 중단되고 요청이 소진된 뒤에만 실행한다. 스키마 적용은 공통 DB의 `ca_` 이관 스키마를 준비한다. 정상 배포 설정에는 `DB` 바인딩만 있다.

```sh
node scripts/migrate-course-allocation.mjs --prepare-config
pnpm db:migrate:remote
pnpm exec wrangler deploy --config wrangler.allocation-migration.local.json
```

생성된 Git 제외 설정에 `COURSE_ALLOCATION_MIGRATION=true`, 임시 `COURSE_DB`, Cloudflare 버전 메타데이터가 있다. 수동 배포의 출력에서 정확한 Version ID를 기록한다. `GET /api/health`의 `courseAllocationMigrationVersion`이 그 ID인지 확인한다. 실제 관리자 시수배당 쓰기 요청이 `503 allocation_import_paused`이고 `POST /api/courseBridge`가 차단 표식과 410을 반환하는지 확인한다. 다른 모듈의 조회·저장을 확인한다. `allocation_schema_required`는 스키마 미적용이고, 정상 Worker의 `allocation_unavailable`은 빈 업무 스키마다.

## 3. 백업·복사·대조

운영 관리자로 Worker 주소에 로그인한다. 해당 네이티브 관리자 쿠키 한 개를 `COURSE_ALLOCATION_ADMIN_COOKIE` 환경 변수로 안전하게 전달한다. 값은 화면 출력, 명령 인수, 셸 명령 이력, 로그에 남기지 않는다. 아래 `<Version ID>`는 2단계에서 기록한 Cloudflare 배포 버전이다.

```sh
node scripts/migrate-course-allocation.mjs --remote --expected-version <Version ID>
node scripts/migrate-course-allocation.mjs --remote --expected-version <Version ID> --apply
```

첫 명령은 원본 행 수·전체/테이블 해시·버전을 읽기만 한다. 두 번째 명령은 예상 버전과 이전 쓰기 차단을 다시 확인한다. 이후 검증에 쓸 디렉터리를 `private/course-allocation-*/`에 생성한다.

- 원본 `course-allocation-db` 전체 SQL을 내보내고 Worker 페이지를 통해 원본 업무 행과 앱 백업 JSON을 보관한다. SQL 내보내기 동안 원본 DB가 응답하지 않을 수 있으며, 원본은 이미 쓰기가 중단된 상태다.
- 공통 DB에서는 이관 직전의 Time Travel bookmark를 얻어 `target-recovery.json`에 기록한다. 도구는 `wrangler d1 time-travel info DB --json --config wrangler.jsonc`를 쓴다. 이 단계는 읽기 전용이며 공통 DB 전체 SQL 내보내기나 가져오기를 실행하지 않는다.
- 대상 `ca_` 테이블의 빈 상태를 `before.json`에 기록한다. Worker는 관리자 세션을 다시 검사하고 바인딩 매개변수와 D1 batch로 업무 행을 키 순서대로 복사한다. 페이지마다 진행 위치와 해시를 같이 기록한다. 엔터티 인덱스는 삽입 트리거로 재구성한다.
- 원본과 대상을 다시 끝까지 읽어서 전체 해시를 대조하고, 대상 업무 테이블별 JSONL과 `comparison.json`을 저장한다. 중간에 실패하면 쓰기 일시 중지를 유지한다. 원본 해시가 같을 때 같은 명령으로 이어서 실행할 수 있다. 다른 모듈의 정상 쿼리와 같은 D1에서 짧은 배치로 처리한다.

Wrangler 자식 환경에 `WRANGLER_WRITE_LOGS=false`를 강제한다. 내보내기 stdout·stderr는 버리고, Time Travel 응답은 파일로만 기록한다. 전체 SQL과 시수배당 스냅샷에는 인증 정보 또는 업무 자료가 들어갈 수 있다. Git, 정적 배포, CI 산출물, 공개 로그에 넣지 않는다. 도구의 대조 요약에는 자료 ID를 넣지 않는다. 앱 백업은 schemaVersion 1이며 브라우저 메모리에서 누적된 작업 이력은 포함하지 않는다.

## 4. 쓰기 해제

일반 플랫폼 관리자와 허용된 교사로 로그인하여 교과군 버전·가능한 동작·백업을 확인한다. 두 이전 쓰기 경로에 대한 차단 상태와 요청 소진이 유지되는지 재확인한다.

```sh
node scripts/migrate-course-allocation.mjs --remote --expected-version <Version ID> --release
```

도구는 실제 HTTP로 기대 배포 버전, 이전 Worker 쓰기 응답, 이전 Pages의 차단 표식을 확인한다. 별도 해제용 검증에서 원본과 대상의 전체 해시를 다시 계산한 뒤, Worker가 짧은 검증 유효 시간 안에 이전 Pages를 다시 확인하고 해제한다. 하나라도 불일치하면 계속 일시 중지한다. 보고된 비교 파일을 보관한다. 해제 직후 버전·저장·분반배정 전달을 확인한다.

## 5. 정상 배포와 이전 주소

해제 후에만 main에 병합한다. Builds가 승인한 그 커밋을 `wrangler.jsonc`로 배포했는지 빌드·배포 이력에서 확인한다. `/api/health`에서 임시 버전 필드가 사라지고 이관 API가 404이며 배포 바인딩에 `COURSE_DB`와 플래그가 없는지 확인한다. 대시보드의 외부 설정에 전환 플래그가 남지 않게 한다. 정상 UI와 API가 합격한 뒤 승인된 이전 주소 연결 페이지를 게시한다. 이전 Pages API 차단은 유지한다.

## 원복

- **해제 전:** 기존 Worker 버전과 `COURSE_DB` 경로로 돌아가고 필요하면 이전 Pages 배포를 복구한다. 원본 스냅샷을 대조하고 원본에서 다시 편집할 수 있다. 다음 이관 시 1·2단계부터 다시 진행한다. 기존 원본에 변경이 생겼다면 `--apply`가 해시 차이를 보고 멈춘다.
- **미해제 이관분 정리:** 이전 쓰기가 다시 차단되고 이관 Worker 버전이 확인되면 `node scripts/migrate-course-allocation.mjs --remote --expected-version <Version ID> --reset-paused`로 대상의 업무 스냅샷을 먼저 보관한다. 이후 백업한 이관 버전과 대상 해시를 확인하고, 같은 트랜잭션에서 `ca_` 업무 행과 이관 표지만 제거한다. 한 번이라도 해제한 이관분에는 이 명령을 사용할 수 없다. 정리 후 기존 원본의 새 저장을 포함한 `--apply`를 다시 진행한다.
- **해제 전 Time Travel 대안:** 공통 DB 차원의 장애 복구가 필요하다면 `target-recovery.json`의 복구 지점을 검토한다. 공통 DB 전체를 되돌리므로 다른 모듈의 변경 손실과 영향에 대한 별도 승인을 받아야 한다. 시수배당 이관만 되돌릴 때는 위 `ca_` 정리를 사용한다.
- **해제 후:** 양쪽 쓰기를 중단하고 원본 동결 스냅샷, 대조 스냅샷, 해제 후 `ca_` 업무 변경·작업 버전·도구 간 전달 기록을 비교한다. 새 수정의 반영 방법과 이전 바인딩 복귀를 승인받는다. 이 경로에 공통 DB 전체 복구를 적용하지 않는다.

## 로컬 리허설

`node tests/course-migration.mjs`는 독립적인 Miniflare Worker·두 D1과 가상 이전 Pages 응답으로 위 관문을 검증한다. `test-results/course-migration-*/comparison.json`과 `commands.json`에 비교와 명령별 종료 코드가 있다. 독립적으로 실행할 경우 기본은 로컬 읽기 전용이다. `--url`에는 루프백 주소만 사용하고, `--expected-version`과 가상 관리자 환경 쿠키를 제공한다. 로컬 `--apply`의 `--persist-to`는 실행 중인 이관 Worker의 격리 상태 경로와 같아야 한다. 가상 복구 정보는 실제 Cloudflare bookmark가 아니다.
