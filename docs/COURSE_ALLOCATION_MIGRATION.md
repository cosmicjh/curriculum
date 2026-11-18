# 시수배당 DB 운영 이관과 원복

[승인 설계](design/platform-consolidation.md)를 따른다. 운영 실행, 배포, 주소 게시에는 사용자 승인이 필요하다. 이번 작업은 로컬 가상 자료 리허설까지다.

## 로컬 리허설

저장소 루트에서 `node tests/course-migration.mjs`를 실행한다. 테스트는 고유한 `test-results/course-migration-*/state` 아래에 D1 두 개를 만들고 원본 데모와 12개 교과군 규모의 과거 학기 자료를 넣는다. `comparison.json`에 전후 차이, 멱등 재실행, 변조 감지, 원복 대조를 기록한다. `commands.json`에는 실제 로컬 명령과 종료 코드가 남는다. SQL 및 앱 백업은 Git에서 제외된 `private/course-allocation-*/`에 생성된다.

독립적으로 도구를 실행할 때는 `node scripts/migrate-course-allocation.mjs --local --persist-to <격리된 Wrangler 로컬 상태 경로>`를 사용한다. 모드 생략 시 로컬 사전 검사가 기본이다. 기본 로컬 상태 경로는 `.cache/allocation-migration`이다. 대상의 평소 개발용 D1과 다른 경로를 선택한다.

## 운영 이관

1. 승인 커밋과 검증 결과를 확인하고 현재 Worker 배포 버전, GitHub Pages 산출물, 이전 주소 배포 버전을 기록한다. 원본은 `course-allocation-db`, 대상은 `school-timetable-db`다. 단일 DB Worker의 자동 배포보다 이관이 먼저 완료되도록 게시 시점을 통제한다.
2. `node scripts/migrate-course-allocation.mjs --remote`로 읽기 전용 사전 검사한다. 출력의 행 수, 전역·교과군 버전, 백업 SHA-256, ID 집합의 SHA-256을 기록한다.
3. 기존 Worker의 `/api/courseWorkspace`, `/api/courseBridge`와 이전 Cloudflare Pages의 `/api/*`를 유지보수 응답으로 전환하고 진행 중인 요청이 끝날 때까지 기다린다. 기존 GitHub Pages 화면의 요청도 같은 API에서 차단된다. 실제 응답과 사용자 공지를 확인한다. 원본 DB 파일·테이블·트리거는 그대로 둔다. 이 단계에는 이전 배포를 담당하는 운영자의 별도 승인과 실행이 필요하다.
4. `node scripts/migrate-course-allocation.mjs --remote --apply`를 실행한다. 두 DB의 전체 SQL, 시수배당 앱 본문 JSON을 `private/course-allocation-*/`에 내보낸 뒤 스키마를 적용한다. 대상 업무 테이블이 비어 있어야 한다. 복사한 대상은 쓰기 일시 중지 상태에 있고 원본 스냅샷을 다시 대조한다. 같은 스냅샷으로 재실행하면 행을 다시 넣지 않는다. 도구가 불일치를 보고하면 배포·해제를 중단한다.
5. 통합 Worker를 배포하고 `/api/health`의 `courseAllocationStorage: "shared-d1"`를 확인한다. 관리자와 허용된 교사로 로그인하여 교과군, 버전, 백업 JSON을 대조한다. 대상 저장은 계속 일시 중지 상태다. 새 GitHub Pages와 이전 주소의 연결 페이지를 게시한다. 이전 Pages API가 쓰기를 받을 수 없는지 확인한다.
6. `node scripts/migrate-course-allocation.mjs --remote --release`로 원본과 대상을 다시 대조하고 대상의 쓰기를 재개한다. 검증된 Worker를 확인한 뒤 해제한다. 확정·재개 권한, 교사 정책, 분반배정 전달 경로를 확인한다. 이전 원본과 백업은 보관한다.

전체 SQL에는 인증 데이터와 학교 업무 자료가 포함될 수 있다. Git, 정적 배포, CI 산출물, 공개 로그에 넣지 않는다. `source.json`은 앱의 schemaVersion 1 본문이며 브라우저 세션에서 누적된 작업 이력은 DB에 저장되지 않는다.

## 원복

- 해제 전 실패 시 기존 Worker 배포 버전과 `COURSE_DB` 바인딩, 기존 Pages 배포를 복구한다. 필요하면 이전 GitHub Pages 산출물과 주소도 복구한다. 원본의 사전 검사 결과를 대조한 뒤 원본 경로의 유지보수를 해제한다. 대상 `ca_` 행은 보존하고 통합 쓰기는 일시 중지한다.
- 해제 이후에는 양쪽 쓰기를 중단하고 공통 DB를 먼저 백업한다. 전환 이후 변경은 원본에 자동으로 반영되지 않는다. 시수배당 업무 행과 다른 모듈 전달 내역까지 비교하여 데이터 복구 범위를 승인받은 뒤 이전 바인딩으로 복귀한다.
- 공통 DB의 다른 모듈에는 학생·교사·출석 자료가 있으므로 시수배당 원복을 위해 공통 DB 전체를 교체하지 않는다.

원격 SQL 업로드와 실제 배포 경로는 별도 승인 이후 검증한다. 로컬 리허설은 원본 바인딩의 스냅샷이 보존되고, 대상에서 새 저장을 받아도 원본 해시가 바뀌지 않는지 확인한다.
