# GitHub Pages 주소에서 직접 사용 · 2026-11-02

2026-11-02에 GitHub Pages에서 화면을 직접 게시하기 시작했습니다. 현재 화면은 [cosmicjh.github.io/curriculum](https://cosmicjh.github.io/curriculum/)에서 제공합니다.

| 구성 | 위치 |
| --- | --- |
| 학생·교사 진입 | https://cosmicjh.github.io/curriculum/ |
| 학생 화면 | https://cosmicjh.github.io/curriculum/student.html |
| 교사 화면 | https://cosmicjh.github.io/curriculum/teacher.html |
| 관리자 | https://cosmicjh.github.io/curriculum/admin.html |
| API | https://school-timetable.cosmicjh.workers.dev/api/* |
| 데이터 | 기존 school-timetable-db, DB 바인딩·ID 유지 |
| 소스·운영 브랜치 | cosmicjh/curriculum, main |

## 화면 게시

`.github/workflows/pages.yml`이 main push 시 `pnpm build:pages`를 실행하고 `.cache/pages-site`의 공개 HTML·CSS·JS만 GitHub Pages에 게시합니다. 기존 HTML 내장 Pretendard와 모바일·인쇄 스타일을 보존합니다. 화면 빌드에는 API 주소만 공개 설정으로 넣고 서버 소스·원본 자료·DB·비밀값·시험 fixture를 포함하지 않습니다.

기존 연결 전용 workflow·빌더는 제거합니다. 새 버전의 JS·설정을 예전 Apps Script 클라이언트 캐시와 섞지 않도록 파일 참조에 버전 값을 부여합니다. 학교 데이터 계산·수정 보호와 성능 최적화는 이번 작업에서 변경하지 않습니다.

## 인증과 브라우저 동작

GitHub Pages는 정적 호스팅이므로 API는 Cloudflare를 유지합니다. 서로 다른 도메인의 쿠키에 의존하면 모바일 등의 타 사이트 쿠키 정책에 영향을 받으므로, GitHub 화면은 HTTPS API 로그인으로 받은 세션을 탭의 JavaScript 메모리에만 보관합니다. 새로고침·탭 종료 후에는 재로그인합니다. 비밀번호나 실제 토큰을 localStorage·sessionStorage·쿠키·URL에 저장하지 않습니다. sessionStorage에는 화면 표시용 표식과 역할·만료 시각만 있습니다. [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [브라우저 타 사이트 쿠키](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Third-party_cookies)

기존 Workers 직접 접속은 HttpOnly·Secure·SameSite=Strict 쿠키를 그대로 사용합니다. GitHub 메모리 세션은 기존 쿠키 세션과 저장 키를 구분하고 서버에 출처와 토큰 해시만 저장합니다. 요청마다 역할·만료·비밀번호 인증 버전을 D1에서 확인합니다. 저장 트랜잭션의 세션 가드도 동일하게 적용합니다. 로그아웃·로그인 실패는 사용 중인 세션을 폐기하고 비밀번호 변경은 대상 역할의 모든 세션을 폐기합니다.

API는 Worker 자체 출처와 `FRONTEND_ORIGIN=https://cosmicjh.github.io`만 허용합니다. GitHub 요청에는 정확한 CORS 출처와 필요한 사전 요청 헤더만 응답하며 와일드카드나 쿠키 전송을 허용하지 않습니다. 보호 응답과 로그인 응답은 no-store입니다. [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)

## 배포·검증

1. API 변경은 기존 계정으로 `pnpm run deploy`를 먼저 실행합니다. D1 재생성·마이그레이션·비밀번호 초기화가 필요하지 않습니다.
2. main에 푸시하면 Pages workflow가 실제 화면을 게시합니다. 현재 저장소의 Pages 게시 방식은 GitHub Actions입니다.
3. GitHub 주소가 유지되는지와 교사·관리자 로그인·로그아웃, 새로고침 후 재로그인을 확인합니다.

`pnpm test`는 출처 제한·세션 해시·역할·학생 저장·비밀번호 변경과 기존 계산을 검증합니다. `pnpm test:pages-browser`는 외부 운영 주소를 사용하지 않는 `.test` 가상 호스트와 로컬 Miniflare D1에서 쿠키 없이 화면·저장·새로고침·로그아웃을 검증합니다. 운영 DB에 fixture를 복원하거나 가상 학생을 등록하지 않습니다. 기존 브라우저·Wrangler 검증도 유지합니다. 성능 벤치마크는 실행하지 않습니다.

실제 Cloudflare 계정·D1·운영 자료·백업·비밀번호는 기존 값을 유지합니다. 새 프로젝트나 새 DB, 별도 Google 연결은 필요하지 않습니다.
