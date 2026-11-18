# 시수배당 vendor 동기화

이 기록은 `923e9b6` 시점의 동기화 방식이다. 현재 빌드는 `modules/allocation/`의 소스를 사용한다. [시수배당 이관과 원복](COURSE_ALLOCATION_MIGRATION.md)

원본: `course-allocation@eb75f3c071cdd19b4d0ba7243d6f58da73890e14`.
기존 vendor는 통합 커밋 `db790ea`에서 들어왔으며 당시 원본 `0743946`의 `index.html`과 비교해 아래 적응 사항을 확인했다.

## 보존한 통합 적응

- CDN 글꼴과 독립 `config.js`·appId·apiBase 설정을 제거하고 `../assets/font.css`를 사용한다. 원본 `shared/ui.css`는 그대로 복사한다. 낮은 우선순위의 원본 기본 글꼴보다 호스트의 `Timetable UI` 우선 스택이 이긴다.
- 별도 로그인·토큰 저장·직접 fetch 대신 부모의 `courseAllocationRequest(window,path,method,data)`를 사용한다. 부모의 iframe 신원·역할 검사와 기존 API를 유지한다.
- PUT의 동일 작업 ID 재시도, 확정 응답 이후 pending 제거, 4xx 이후 pending 제거, 성능 기록을 유지한다.
- 부모 역할을 사용하는 linked 모드로 독립 관리자·암호 변경 화면을 숨긴다. 관리자 동작의 접근 거부 문구도 기존 통합판과 같다.
- `hasUnsavedCourseChanges()`와 `openSectionAssignmentHours(term,id)`를 노출한다. 서버 분반배정 조회·전달 ID·학기 확인과 준비 완료 대기를 보존한다.
- `서버 분반배정`, `분반배정 파일`, `교육과정 편성·운영 지원 도구로 전달` 동작·문구, 시수배당표 제목과 모바일 학기 표시를 보존한다.
- 원본 주석 대신 HTML과 manifest에 정확한 새 원본 커밋 및 생성 스크립트를 기록한다. HTML은 배포 시 `view.html`이 되며 번들 경로는 상대 경로다.
- 원본 공통 버튼의 중앙 정렬 기본값과 무관하게 통합 사이드바는 명시적으로 왼쪽 정렬한다. 접힌 사이드바의 기존 가운데 정렬은 유지한다.

## 생성과 파일 범위

원본 저장소에서는 다음 빌드만 실행한다. 추적 파일은 수정하지 않는다.

```powershell
node scripts/build.mjs
node scripts/build-github.mjs
```

이 저장소에서 실행한다(선택 인수는 원본 저장소 경로).

```powershell
node scripts/sync-course-allocation.mjs
node scripts/build.mjs
```

동기화 스크립트는 고정한 원본 커밋과 UI 소스의 무수정을 확인한다. 원본 `dist/index.html`, 해시 CSS, `shared/ui.css`를 복사하고, JS는 같은 원본 진입점에 위 iframe 적응과 `scripts/course-allocation-transport.js`만 적용해 동일한 esbuild 옵션으로 다시 번들한다. 원본 트리나 원본 산출물은 수정하지 않는다. 변경 지점은 일치 횟수를 검사하므로 원본 구조가 달라지면 실패하며 재검토가 필요하다.

`vendor/course-allocation/assets/`의 새 해시 JS/CSS, HTML, 원본 CSS의 SHA-256을 `manifest.json`에 기록한다(텍스트 줄바꿈은 LF로 정규화). UI 해시 기준도 갱신한다. 통합 빌드는 해시 assets를 복사하며 Pages 자산 버전 계산에도 포함한다. 비밀 설정과 원본 config는 복사하지 않는다.

기존 브라우저 전용 `shared/transport.js`, `performance.js`, `print.js`, `reset.js`는 번들에 들어가고 다른 사용처가 없어 제거했다. 서버·전달 파서가 사용하는 `domain.js`, `state.js`, `catalog.js`, `hours-import.js`와 솔버의 `timetable-model.js`, `timetable-cpsat.js`, `timetable-checker.js`는 기존 버전을 그대로 보존했다. vendor 서버·마이그레이션과 통합 `src/`도 변경하지 않았다.

## 검증

`test:all`의 모든 Node 명령을 직접 실행한다. 특히 `node tests/allocation-browser.mjs`, `node tests/browser-solver.mjs`, `node tests/section-assignment-browser.mjs`는 부모 세션·미저장 내용·자료 전달·솔버의 유지 여부를 검사한다. `course-vendor.test.mjs`는 산출물 해시·경로·로컬 글꼴·공유 모듈 보존을, UI 시험은 교사·관리자 iframe을 포함해 36개 화면을 검사한다.

데스크톱·모바일 캡처: `test-results/course-desktop.png`(1920px), `course-mobile.png`(390px), `course-unified-1440.png`, `course-unified-390.png`. UI 캡처는 사이드바 전환 애니메이션과 CSS 로딩이 끝난 뒤 저장한다. 전체 명령별 종료 코드와 로그는 Git 제외 `test-results/vendor-all-commands.json`, `vendor-all.log`에 남긴다.

배포·push와 운영 자료 검증은 이 동기화에 포함하지 않는다.

## 2026-11-16 실행 결과

원본 빌드 두 명령과 동기화 스크립트는 종료 코드 0이다. test:all의 모든 Node 하위 명령은 아래와 같이 종료 코드 0이며 단위·통합 74/74, UI 36개 화면 검사가 통과했다.

| 명령 | 종료 코드 |
| --- | ---: |
| `node --test --test-concurrency=1 tests/*.test.mjs` | 0 |
| `node tests/browser.mjs` | 0 |
| `node tests/solver-browser.mjs` | 0 |
| `node tests/browser-solver.mjs` | 0 |
| `node tests/section-assignment-browser.mjs` | 0 |
| `node tests/pages-browser.mjs` | 0 |
| `node tests/wrangler.mjs` | 0 |
| `node tests/teacher-tools-browser.mjs` | 0 |
| `node tests/allocation-browser.mjs` | 0 |
| `node tests/studyroom-browser.mjs` | 0 |
| `node tests/ui-browser.mjs` | 0 |

공통 CSS 적용 후 사이드바 정렬을 유지하는 배치 규칙을 추가하고, UI 캡처가 전환 애니메이션을 기다리도록 했다. 이후 `node --test tests/course-vendor.test.mjs tests/ui.test.mjs`, `node tests/ui-browser.mjs`, `node tests/pages-browser.mjs`를 추가 실행해 모두 종료 코드 0을 확인했다. 시수배당표의 파일 가져오기·서버 전달·미저장 내용·부모 세션 및 실제 브라우저 WASM 솔버 검사는 기존 시험을 유지했다.

수동 디자인 검사는 실행했으며 소스 vendor HTML의 로컬 글꼴 링크는 배포 경로 기준이어서 검사기가 직접 해석하지 못한다. 실제 빌드 경로·로컬 글꼴 요청·Timetable UI 우선 스택은 브라우저 검증으로 확인했다. 원본 저장소의 git status는 변경이 없고 통합 src도 변경하지 않았다.

## 변경 파일

- `vendor/course-allocation/index.html`, `manifest.json`, `shared/ui.css`, `assets/workbook-6QEIHVZF.js`, `assets/workbook-APTSXI6R.css`.
- `scripts/sync-course-allocation.mjs`, `course-allocation-transport.js`, `build.mjs`, `build-pages.mjs`.
- `assets/style.css`의 사이드바 정렬 한 규칙.
- `tests/course-vendor.test.mjs`, `ui-browser.mjs`, `wrangler.mjs`, `fixtures/ui-baseline.json`.
- 이 문서와 `docs/PERFORMANCE.md`의 임시 CSS 동기화 안내.
- 삭제: vendor `shared/performance.js`, `print.js`, `reset.js`, `transport.js`.
