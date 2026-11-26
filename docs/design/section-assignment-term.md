# Design: 분반배정 대상 학기 전환

Status: Approved by user (2026-11-26)

## Objective and scope

통합시간표 운영 학기(예: 2026-2)와 관계없이, 분반배정 결과를 다음 학기(예: 2027-1) 시수배당표로 미리 보낼 수 있게 한다.
분반배정 화면에 "대상 학기"와 관리자용 "학기 전환" 동작을 추가한다. 분반배정 계산·배정 제약·결과 형식은 바꾸지 않는다.

## Current system and constraints

- 분반배정(`assets/section-assignment/`)은 브라우저에서 계산한다. 서버와는 호스트(`assets/app.js`)의
  `window.sectionAssignmentConnect` bridge로만 통신한다: `importHours`, `loadCourseSections`, `previewStudents`.
- `importHours` → `stageToolTransfer({term:state.admin.store.term,kind:'hours'})`. 서버(`src/worker.js`의 `stageToolTransfer`)는
  `req.term!==ctx.term`이면 `TERM_CHANGED`로 거부한다. 그래서 분반배정 자료는 통합시간표 운영 학기로만 저장된다.
- 시수배당표는 이미 학기를 따로 전환한다(`docs/design/allocation-term-switch.md`). 시수배당 `/assignment-hours`는
  시수배당 현재 학기의 `tool_transfers(term,'hours')`를 읽는다. 따라서 시수배당이 2027-1이면 받을 자료가 없다.
- `tool_transfers.term_id`는 `terms(id)`를 참조한다. 시수배당 → 통합시간표 전달(`storeCourseTransfer`)은
  이미 `INSERT OR IGNORE INTO terms`로 운영 학기가 아닌 학기에도 저장한다.
- `loadCourseSections`(시수배당 분반 수 불러오기)는 `courseTransfer`(summary `counts`)로 운영 학기(`ctx.term`)만 읽는다.
- `previewStudents`는 운영 학기 학생 명부로 미리보기·반영하는 기능이다(학생 데이터, 고위험).
- 관리자 쓰기는 `expectedTerm`/`expectedRevision`과 `write_guards`로 보호된다.

## Selected approach (사용자 결정 2026-11-26)

- **대상 학기**: 분반배정의 서버 주고받기 대상 학기다. 호스트 관리자 화면 메모리에 두고 메뉴를 바꿔도 유지한다.
  새로고침이나 로그아웃 뒤에는 기본값으로 돌아간다.
- **기본값 = 시수배당 현재 학기**. 시수배당 학기를 읽지 못하면(이관·동결 등) 통합시간표 운영 학기를 쓴다.
  호스트가 시수배당 학기를 알 수 있도록 기존 관리자 전용 `courseWorkspace` GET `/term` 응답에 시수배당 현재 학기를 추가한다.
  같은 의미의 더 단순한 읽기 경로가 있으면 그것을 써도 된다. DB 스키마는 바꾸지 않는다.
- **표시와 전환**: 분반배정 화면 위쪽에 대상 학기(예: "2027학년도 1학기")와 텍스트 버튼 "학기 전환"을 둔다.
  운영 학기와 다르면 "통합시간표 2026-2" 같은 보조 표시를 둔다. 전환 창에서는 학년도와 학기를 고른다(서버 `validTerm` 범위).
  계산 중이거나 전송 중이면 전환을 막는다. 공통 UI 규칙을 따른다: 텍스트 버튼, 회색조, Pretendard, 불필요한 안내 문구 없음.
- **시수배당으로 보내기**: 대상 학기로 `stageToolTransfer(kind:'hours')`를 보낸다. 서버는 `hours`일 때 `validTerm`인 임의 학기를 허용한다.
  `terms`에 그 학기가 없으면 같은 batch에서 `newTermSettings(ctx.settings,term)`로 `INSERT OR IGNORE`한다.
  `expectedTerm`/`expectedRevision` 쓰기 가드는 그대로 운영 학기 기준이다. 보낸 뒤 시수배당표 탭으로 가는 기존 흐름을 유지한다.
  시수배당 학기가 다르면 기존 `term_mismatch` 안내가 나오면 된다.
- **시수배당 분반 수 불러오기**: 대상 학기의 확정 분반 수를 읽는다. `courseTransfer` counts 읽기에 선택적 `term`(검증)을 받고,
  생략하면 기존처럼 운영 학기다. 안내 문구의 "현재 학기"는 실제 대상 학기로 표시한다.
- **학생 배정 미리보기**: 대상 학기가 운영 학기와 같을 때만 허용한다. 다르면 버튼을 비활성화하고 이유를 상태 문구로 보인다.
  서버도 `kind:'students'`는 지금처럼 `req.term===ctx.term`만 허용한다.

## Rejected alternatives

- 통합시간표 운영 학기를 기본값으로 하기: 사용자가 시수배당 현재 학기를 골랐다.
- 다른 학기 학생 배정을 미리 저장하기: 학생 데이터 범위가 커져 사용자가 고르지 않았다.
- 대상 학기를 DB에 저장하기: 불필요하다. 화면 메모리와 기본값 규칙으로 충분하다.

## Compatibility, privacy and migration risks

- 마이그레이션·스키마·백업 형식·ID·전달 JSON 형식(`school-course-hours`, `tool_transfers`)은 바꾸지 않는다.
- 운영 학기가 아닌 학기로 처음 보내면 플랫폼 `terms`에 그 학기가 생긴다. 설정의 운영 학기 목록에 나타나며,
  시수배당 → 통합시간표 전달과 같은 동작이다. 운영 학기는 바뀌지 않는다.
- 같은 학기로 다시 보내면 그 학기의 이전 분반배정 전달본을 덮어쓴다. 지금과 같은 동작이다.
- 학생 데이터 경로는 넓히지 않는다. 다른 학기의 학생 전달은 화면과 서버 모두에서 거부한다.

## Testable acceptance conditions

- 서버(API 시험): 운영 학기 2026-2에서 `stageToolTransfer(term:'2027-1',kind:'hours')`가 성공한다. 이때 `terms`에 2027-1이 생기고 운영 학기는 2026-2로 남는다.
  시수배당을 2027-1로 전환하면 `/assignment-hours`가 그 자료를 받는다. 잘못된 학기(`2027-3` 등)는 거부한다.
  `kind:'students'`의 다른 학기는 거부한다. 교사는 모두 거부한다. 기존 `TERM_CHANGED`·쓰기 가드 시험을 유지한다.
- `courseTransfer` counts가 `term`으로 다른 학기를 읽고, 생략하면 운영 학기를 읽는다. 잘못된 `term`은 거부한다.
- 브라우저(`tests/section-assignment-browser.mjs` 또는 인접 시험): 분반배정을 열면 기본 대상 학기가 시수배당 현재 학기다.
  운영 학기와 다를 때만 보조 표시가 나온다. "학기 전환"으로 2027-1을 고르고 보내면 2027-1에 저장된다.
  다른 학기에서는 학생 배정 미리보기가 비활성화된다. 메뉴를 바꿨다 돌아와도 선택이 유지된다.
- 기존 `pnpm test:all` 전체(UI 규칙 시험 포함)가 통과한다.
