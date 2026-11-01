# main 전환·임시 자원 정리 · 2026-11-02

개인시간표 전환 코드와 배포 설정을 main으로 통합합니다. 기존 전환 커밋의 이력을 보존하는 fast-forward 방식이며, 다른 도구인 course-allocation 저장소·Pages·DB는 작업 대상에서 제외합니다. 이번 작업에는 성능 개선이나 벤치마크 실행을 포함하지 않습니다.

## 운영 구성

- 저장소: [cosmicjh/timetable · main](https://github.com/cosmicjh/timetable/tree/main)
- 서비스: [school-timetable.cosmicjh.workers.dev](https://school-timetable.cosmicjh.workers.dev)
- Worker: school-timetable, ASSETS → dist/, DB → 기존 school-timetable-db.
- D1 ID: c4c3186c-bcfa-4bb9-959f-5086151abce8. 새 DB를 만들거나 기존 DB를 초기화하지 않습니다.
- 기존 Secret·계정·학기·운영 자료·서버 백업을 보존합니다. 스키마 변경이나 운영 자료 수정 SQL을 실행하지 않습니다.
- 기존 https://cosmicjh.github.io/timetable 주소는 연결 전용 Pages workflow로 보존합니다. 학생·교사·관리자 경로와 query/hash를 새 서비스로 연결하고, 과거 Apps Script 연결 화면을 이중 운영하지 않습니다.

## 정리 범위

| 구분 | 처리 |
| --- | --- |
| Git 전환 브랜치 codex/workers-d1 | main 반영·검증 후 원격과 로컬에서 삭제. 커밋 이력은 main에 유지 |
| 이전 가상 시험 artifact 2건 | synthetic-local-results, 12961243460 / 12961125774 삭제. 테스트 결과 이력 자체는 보존 |
| GitHub Actions 캐시 | 조사 당시 0건. 다른 저장소의 캐시는 건드리지 않음 |
| Cloudflare 시험 프로젝트·시험 DB | 조사 당시 없음. 확인되지 않은 자원을 임의 삭제하지 않음 |
| Cloudflare 운영 자원 | school-timetable + school-timetable-db 유지. course-allocation Pages·DB도 보존 |
| 로컬 생성물 | 오래된 test-results, .cache의 일회성 조사 스크립트·로그, .wrangler 임시 번들·캐시, 생성된 dist·로컬 Wrangler 설정 정리 |
| 운영 복구·개발 자원 | private/bootstrap.local.json, .dev.vars, 필요한 소스·의존성·가상 회귀 fixture와 라이선스는 유지 |
| Pages 전용 잔재 | 루트 .nojekyll 제거. 연결 전용 산출물에만 배포 시 생성 |

운영 Worker의 이전 버전은 롤백 이력이므로 시험용 정크로 취급해 삭제하지 않습니다. 기존 Apps Script·Google 스프레드시트 운영 자료도 삭제하지 않습니다.

## 검증과 성능 작업 제외

업무 계산·권한·D1 저장 로직과 기존 네 HTML·모바일 CSS는 변경하지 않습니다. 기능 회귀, 원본 화면 해시, 고정된 새 주소로의 기존 URL 연결, 실제 운영 API·정적 파일·바인딩을 확인합니다. CI의 자동 benchmark 실행은 제거하며 향후 성능 작업용 개발 스크립트는 보존합니다.

연결 전용 Pages 배포는 main에서 별도 workflow로 실행합니다. 업무 서비스 배포는 기존 Wrangler 명령 `pnpm run deploy`를 사용합니다. GitHub와 Cloudflare Builds를 별도로 연결할 때도 운영 브랜치는 main입니다. 기존 Wrangler OAuth는 Builds API에서 403을 반환하므로 그 API를 사용한 설정 변경은 하지 않습니다.
