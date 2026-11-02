# Cloudflare 배포·복구 안내

접속 화면은 [cosmicjh.github.io/timetable](https://cosmicjh.github.io/timetable/)에서 제공하고 API는 기존 school-timetable Worker에 있습니다. [GitHub Pages 주소 구성](GITHUB_PAGES_2026-11-02.md)을 확인하세요. 현재 계정의 D1 생성·스키마·Secret 등록은 완료했으므로 재생성하지 않습니다. 아래 최초 준비 절차는 새 계정/새 설치용입니다. [실제 배포 결과](DEPLOYED_2026-10-30.md)를 먼저 확인하세요.

이 안내의 명령은 개인시간표 GitHub 저장소 루트에서 실행합니다. 이 작업의 로컬 복제본은 `course-allocation/timetable-cloudflare`입니다. 기존 시수배당 저장소 루트의 Wrangler 파일과 DB는 다른 서비스입니다.

## 최초 준비와 배포

1. `pnpm install --frozen-lockfile`, `pnpm test:all`을 실행합니다. 로컬 실행은 README 순서를 따릅니다.
2. Cloudflare 계정으로 로그인합니다. 아래 명령은 원격 자원을 생성하므로 배포할 계정을 확인합니다.

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 create school-timetable-db
```

3. 출력된 **실제 database_id**를 `wrangler.jsonc`의 `d1_databases[0]`에 추가합니다. account_id는 Wrangler 로그인 계정 선택 또는 빌드 환경의 CLOUDFLARE_ACCOUNT_ID로 정합니다. 확인되지 않은 ID는 저장소에 넣지 않았습니다. `wrangler.local.json`의 로컬 식별자는 복사하지 않습니다. 다른 도구의 DB를 연결하지 않습니다.
4. 새 원격 DB에만 스키마를 적용합니다. 운영 중인 다른 DB에 테스트 시드·초기화 SQL을 실행하지 않습니다.

```sh
pnpm db:migrate:remote
pnpm setup:production
pnpm run deploy
pnpm exec wrangler secret bulk private/bootstrap.local.json
```

`setup:production`은 `private/bootstrap.local.json`에 PASSWORD_PEPPER와 교사·관리자 초기 솔트 해시를 생성하고 기존 파일을 덮어쓰지 않습니다. 파일은 Git 제외입니다. 첫 deploy 직후 비밀값 등록 전에는 로그인 API가 설정 오류를 반환합니다. secret bulk가 완료된 뒤 로그인합니다. Cloudflare 대시보드의 `school-timetable` Worker에도 세 개 이름의 Secret이 등록되었는지 확인합니다. 최초 해시를 재생성해도 기존 DB 계정은 바뀌지 않습니다. PASSWORD_PEPPER는 운영 시작 후 임의 교체하지 말고 복구용으로 안전하게 보관합니다.

5. Wrangler가 출력한 HTTPS Workers 주소로 접속합니다. `/api/health`가 JSON을 반환하는지 확인합니다. 교사·관리자 초기 비밀번호 `1234`로 각각 로그인한 뒤 관리자 → 설정에서 비밀번호를 변경합니다. 변경 후 이전 세션이 차단되는지 확인합니다.
6. 기존 백업을 복원하거나 기존 엑셀 5개를 등록합니다. [이관 절차](MIGRATION.md)에 따라 건수와 시간표·명렬표 결과를 비교한 다음 새 주소를 안내합니다.

2026-10-30 후속 작업에서 새 Worker·새 DB 생성, Secret 등록, 원격 마이그레이션과 배포를 수행했습니다. 실제 학생 자료 이관은 아직 수행하지 않았습니다. 위 명령은 다른 계정에서 처음 구성할 때의 순서입니다.

## GitHub 연동 자동 배포

기존 GitHub 저장소 `cosmicjh/timetable`을 유지합니다. Cloudflare → Workers & Pages에서 **Worker** `school-timetable`의 Builds에 이 저장소를 연결합니다. Cloudflare Pages 프로젝트를 생성하지 않습니다. GitHub Pages는 `.github/workflows/pages.yml`이 실제 화면을 게시합니다.

| 설정 | 값 |
| --- | --- |
| Worker 이름 | `school-timetable` (wrangler name과 동일) |
| Root directory | `/` (timetable 저장소 루트) |
| Install | `pnpm install --frozen-lockfile` |
| Build command | `pnpm build` |
| Deploy command | `pnpm run deploy` |
| Production branch | `main` |
| Assets | `./dist`, ASSETS 바인딩 |
| D1 | DB → 실제 `school-timetable-db` |

자동 배포에 필요한 Cloudflare 권한은 Builds 연결에서 설정합니다. 외부 CI를 사용하면 GitHub Secret에 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID를 설정합니다. 토큰과 bootstrap 파일을 커밋하지 않습니다. 검증용 GitHub Actions는 가상 자료 기능 테스트만 수행하며 운영 자료 이관이나 성능 벤치마크를 실행하지 않습니다. GitHub Pages workflow는 검증된 공개 HTML·CSS·JS만 게시하고 API·DB·시험 자료·비밀값을 포함하지 않습니다.

마이그레이션은 최초 배포 전에 위 순서로 실행합니다. 이후 새 SQL 마이그레이션을 추가할 때도 원격 DB 백업 후 호환성 검토와 명시적인 마이그레이션을 먼저 실행합니다. 코드 재배포만으로 DB·계정·학생 자료를 초기화하지 않습니다.

## 접속 주소와 운영 자료 보존

운영 주소는 https://cosmicjh.github.io/timetable/ 입니다. GitHub Pages가 실제 화면을 표시하며 다른 사이트로 이동시키거나 iframe으로 감싸지 않습니다. API와 데이터는 기존 Cloudflare Worker·D1을 계속 사용합니다.

main push 시 Pages workflow가 pnpm build:pages를 실행하여 공개 파일만 게시합니다. Cloudflare API 코드 변경은 pnpm run deploy로 먼저 반영합니다. FRONTEND_ORIGIN은 https://cosmicjh.github.io로 제한합니다. 새 DB 생성·스키마 초기화·Secret 재생성은 하지 않습니다.

GitHub 주소에서는 타 사이트 쿠키 없이 탭 메모리 세션으로 인증합니다. 새로고침하면 재로그인합니다. 기존 Worker 직접 접속은 HttpOnly·Secure·SameSite 쿠키를 유지합니다. 두 화면은 같은 계정·D1을 사용하고 서버 권한·로그아웃·비밀번호 변경에 의한 세션 폐기를 동일하게 적용합니다.

## 구성·무료 범위

2026-10-30 공식 문서를 확인했습니다. 최소 구성은 Worker 하나 + Static Assets + D1 하나입니다. KV·Durable Objects·R2·Google API는 필요하지 않습니다.

- 정적 자산 요청은 무료·무제한, Free의 동적 Worker 요청은 하루 100,000건, 요청당 CPU 10ms입니다. [Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/), [CPU 제약](https://developers.cloudflare.com/workers/platform/limits/)
- D1 Free는 하루 읽기 500만 행·쓰기 10만 행·계정 총 5GB, DB당 500MB입니다. [D1 요금](https://developers.cloudflare.com/d1/platform/pricing/), [D1 제약](https://developers.cloudflare.com/d1/platform/limits/)
- D1의 바인드 매개변수는 문장당 100개, 셀/행은 최대 2MB입니다. 등록은 JSON 배열을 작은 묶음으로 바인드하고 백업은 본문을 조각으로 나눕니다. batch는 트랜잭션이며 실패 시 전체 롤백합니다. [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- `/api/*`만 Worker 우선 실행하고 화면은 Static Assets로 제공합니다. [Worker 우선 라우팅](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- GitHub 연결·빌드 명령은 [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), [Builds 설정](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)을 기준으로 했습니다.

로컬 응답 시간은 원격 CPU 집행 결과가 아닙니다. 대규모 등록·복원·학급 인쇄는 실제 운영 자료로 원격 CPU와 D1 사용량을 확인해야 합니다. 무료 구성을 우선하되 측정 결과 한도를 넘으면 Workers Paid 또는 처리 범위 조정을 결정합니다. 무료 운영을 보장했다고 해석하지 않습니다. 인덱스 갱신·백업도 D1 쓰기 사용량에 포함됩니다. 사용량은 D1 대시보드와 API의 X-D1-Rows-Read/Written으로 확인할 수 있습니다.

## 백업과 복구

관리자 변경 이력에서 정기적으로 새 JSON 백업을 다운로드합니다. 등록·복원 전 백업은 서버에 자동으로 남습니다. 백업 목록은 현재 학기의 최근 200개 메타만 조회하며 본문은 다운로드/복원 때 읽습니다. 서버에 보관된 자료를 자동 삭제하지 않습니다.

코드 문제는 이전 Worker 버전으로 롤백하고 DB 스키마 호환성을 확인합니다. 자료 문제는 올바른 학기로 전환한 후 저장된 백업이나 JSON 파일을 복원합니다. 원격 DB 전체를 작업 전에 외부 파일로 보존할 때:

```sh
pnpm exec wrangler d1 export DB --remote --output private/d1-before.local.sql
```

D1 Time Travel은 Free에서 7일 범위입니다. [D1 복구](https://developers.cloudflare.com/d1/reference/time-travel/)에 따라 계정 소유자가 대상 시점을 확인하고 복구합니다. 이 문서의 로컬 테스트 명령은 운영 DB를 복원하거나 삭제하지 않습니다. 인증 정보는 시간표 JSON에 포함하지 않으므로 DB 전체 백업·PASSWORD_PEPPER를 별도로 안전하게 관리합니다.
