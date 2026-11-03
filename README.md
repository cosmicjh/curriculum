# 개인 시간표 · 결보강 도구 · GitHub Pages + Workers API + D1

접속 주소: [cosmicjh.github.io/timetable](https://cosmicjh.github.io/timetable/) · [관리자](https://cosmicjh.github.io/timetable/admin.html)

두 도구의 소스와 빌드를 `cosmicjh/timetable` 저장소에서 관리합니다. 교사 로그인 후 **개인 시간표 · 결보강 · 교과 명렬표 · 학급 인쇄** 탭을 전환하며, 결보강에 다시 로그인할 필요가 없습니다. 개인시간표와 결보강은 기존의 서로 다른 D1 DB를 그대로 연결하므로 자료를 복사하거나 비밀번호를 초기화하지 않습니다. [통합 구조와 배포 안내](docs/teacher-tools.md)

결보강은 별도 문서나 로그인 화면을 열지 않고 시간표 페이지의 기능으로 직접 표시합니다. 글꼴·인쇄 영역·세션을 공유하고, 재로그인이 필요하면 시간표의 공통 로그인 화면에서 처리합니다.

관리자 → 설정의 **교사 비밀번호 변경**, **관리자 비밀번호 변경** 버튼에서 각각 변경합니다. 버튼을 누르면 현재 관리자 비밀번호와 새 비밀번호를 입력하는 창이 열립니다. 교사 비밀번호는 두 통합 도구의 공통 로그인에 적용되며, 관리자 비밀번호를 바꾸면 다시 로그인합니다.

운영 브랜치는 **main**입니다. 전용 Worker·D1을 그대로 사용하며, 화면은 GitHub Pages에서 직접 표시하고 API·데이터는 기존 Cloudflare를 유지합니다. [main 전환·임시 자원 정리 기록](docs/MAIN_RELEASE_2026-11-02.md)을 확인하세요.

`cosmicjh/timetable`의 기존 HTML·모바일 CSS·HTML 내장 Pretendard·엑셀 등록·PNG·인쇄 화면을 유지하고, Apps Script 브리지를 Workers API와 D1으로 교체했습니다. GitHub Pages 화면은 허용된 출처의 API를 호출하며 주소창은 github.io에 유지됩니다. GitHub는 소스 관리와 화면 자동 게시에 계속 사용합니다.

이 프로젝트 루트는 **개인시간표·결보강 통합 저장소의 루트**입니다. 다른 `course-allocation` 프로젝트의 Pages 설정이나 DB를 사용하지 않습니다. 이 작업의 복제본은 `course-allocation/timetable-cloudflare/`, 운영 브랜치는 `main`, 최초 원본 커밋은 `bd6e7db`입니다. GitHub Pages 주소에서 실제 화면을 제공하고 Apps Script·스프레드시트 자료는 삭제하지 않습니다.

GitHub 화면의 로그인은 탭 메모리에서만 유지하므로 새로고침하면 재로그인합니다. 토큰을 localStorage·sessionStorage·쿠키에 저장하지 않습니다. 기존 Workers 직접 접속의 HttpOnly 쿠키 인증도 유지합니다. [주소 전환과 인증 안내](docs/GITHUB_PAGES_2026-11-02.md)

## 로컬 실행

Node.js 22 이상(검증: 24), pnpm 11.25.0.

```sh
pnpm install --frozen-lockfile
pnpm setup:local
pnpm db:migrate:local
pnpm dev
```

`http://127.0.0.1:8787`에 접속합니다. 학생·교사 진입은 `/`, 별도 관리 화면은 `/admin.html`입니다. 새 DB의 교사·관리자 비밀번호는 각각 `1234`입니다. 관리자 → 설정에서 변경합니다. `setup:local` 재실행·재배포는 기존 비밀번호를 덮어쓰지 않습니다.

로컬 명령은 자동 생성되는 Git 제외 파일 `wrangler.local.json`과 로컬 D1 에뮬레이터를 사용합니다. `local-timetable-emulator`는 로컬 저장소 식별자이며 Cloudflare DB ID가 아닙니다. 운영용 `wrangler.jsonc`에는 실제 배포한 계정과 개인시간표 전용 D1 ID를 설정했습니다.

실제 자료는 관리자 → 변경 이력 → 백업 불러오기에서 기존 JSON을 복원하거나, 자료 등록에서 기존 엑셀 5개를 미리보기 후 등록합니다. 학교의 전체교사시간표 행·열을 변경할 필요가 없습니다. 운영 자료·비밀값은 `private/` 등 Git 제외 위치에 보관합니다.

## 검증

```sh
pnpm test             # 계산 규칙 + 실제 임시 D1 통합 테스트
pnpm test:browser     # Edge(Windows) / Chromium, 모바일·PNG·인쇄·엑셀·입력 보호
pnpm test:pages-browser # 격리된 두 출처에서 쿠키 없는 로그인·저장 검증
pnpm test:worker      # Wrangler D1 마이그레이션·dry-run·실제 dev 라우팅
pnpm test:all
pnpm benchmark        # 학생 900명·분반 288개·배정 7,200개·교사 120명
```

이번 main 전환에서는 성능 개선과 벤치마크 실행을 제외했습니다. 향후 작업용 benchmark 스크립트는 보존하며 CI에서 자동 실행하지 않습니다.

Linux/macOS에서 브라우저가 없으면 `pnpm exec playwright install --with-deps chromium`을 먼저 실행합니다. 테스트는 가상 자료와 각각 새 로컬 D1을 사용합니다. 원격 DB를 초기화하지 않습니다. 결과·화면·PNG는 Git 제외 `test-results/`에 생성됩니다.

## 배포 설정

| 항목 | 값 |
| --- | --- |
| GitHub 저장소 | `cosmicjh/timetable` |
| Workers 프로젝트 / Wrangler name | `school-timetable` |
| 저장소 루트 | `/` |
| Worker 진입점 | `src/worker.js` |
| Pages build | `pnpm build:pages` → `.cache/pages-site` |
| Worker build | `pnpm build` |
| deploy | `pnpm run deploy` |
| Static Assets | `assets.directory: ./dist`, `binding: ASSETS` |
| API | `https://school-timetable.cosmicjh.workers.dev/api/*` |
| 허용된 화면 출처 | `https://cosmicjh.github.io` |
| D1 | `DB`, 새 `school-timetable-db`, `migrations/` |
| 결보강 D1 | `CLASS_SWAP_DB`, 기존 `class-swap-db`, `vendor/class-swap/migrations/` |

현재 계정의 D1·마이그레이션·인증값 등록은 완료했습니다. 다른 계정의 최초 구성과 재배포·이관·복구 순서는 [배포 안내](docs/DEPLOYMENT.md)를 따릅니다. 화면은 GitHub Pages로 게시하며 Cloudflare Pages 프로젝트는 사용하지 않습니다.

## 구현과 결과

- [자료 등록 연결 오류 수정](docs/IMPORT_FIX_2026-11-02.md)
- [GitHub 주소에서 직접 접속](docs/GITHUB_PAGES_2026-11-02.md)
- [main 전환과 임시 자원 정리](docs/MAIN_RELEASE_2026-11-02.md)
- [기존 API·기능 대응과 저장 구조](docs/ARCHITECTURE.md)
- [배포·GitHub 연동·무료 한도·복구](docs/DEPLOYMENT.md)
- [기존 백업 / 엑셀 이관과 결과 비교](docs/MIGRATION.md)
- [실제로 수행한 검증과 남은 원격 작업](docs/VALIDATION.md)

핵심 파일은 `src/worker.js`(API·권한·조회), `src/storage.js`(조건 조회·트랜잭션), `src/domain.js`(수정 보호·검증), `src/core.js`(첨부 Core.gs의 계산), `src/auth.js`(쿠키·인증), `migrations/0001_timetable.sql`, `assets/transport.js`, `assets/app.js`, `wrangler.jsonc`입니다. 기존 네 HTML과 `assets/style.css`는 원본 그대로 유지합니다.
