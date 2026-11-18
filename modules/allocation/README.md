# 시수배당 모듈

`app/`, `shared/`, `server/`가 통합 시수배당의 원본이다. `tests/`는 저장소 루트의 검증 명령으로 실행한다. `migrations/`는 이전 저장소의 스키마를 재현하는 이관 전용 입력이다. 운영 스키마는 루트 `migrations/`가 관리한다.

[통합 README](../../README.md) · [승인 설계](../../docs/design/platform-consolidation.md) · [이관과 원복](../../docs/COURSE_ALLOCATION_MIGRATION.md)

`docs/`의 기록은 가져오기 시점의 역사 자료다. 원래 독립 빌드·게시·로그인 명령은 Git에서 원본 커밋 `eb75f3c`를 확인한다.
