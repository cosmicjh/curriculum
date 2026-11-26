# Design: 관리자 학생 삭제

Status: Approved by user (2026-11-26)

## Objective and scope

관리자 모드의 학생 관리에서 운영 학기 학생을 한 명씩 삭제한다. 잘못 등록된 학생이나 중복 항목을 정리하기 위해서다.
일괄 삭제, 다른 학기 학생 삭제, 학생 로그인·교사 화면 변경은 범위 밖이다.

## Current system and constraints

- 학생 삭제 기능은 없다. 학생은 학적(재학·전출·자퇴·휴학·졸업)으로 정리한다. 명부 가져오기(`prepareImport`)는 업로드에 없는 기존 학생을 유지한다.
- 관리자 학생 화면은 `assets/app.js`에 있다: `renderStudents`, `renderStudentTable`, `editStudent`, `save-student`.
  서버 쓰기는 `src/worker.js`의 `writes`, `mutate`에서 하고 저장은 `src/storage.js`의 `commit`이 맡는다.
- `assignments`는 `(term_id,student_id)`로 `students`를 참조한다(`ON DELETE CASCADE`). `students`를 참조하는 다른 FK는 없다.
- 스터디룸 `student_person_links(term_id,student_id)`와 `sr_attendance`는 일부러 명부 교체·복원 뒤에도 남는다(`migrations/0004_studyroom.sql`).
  같은 `(term_id,id)` 학생을 다시 넣으면 `student_person_insert` 트리거가 기존 연결을 유지한다.
- 관리자 쓰기는 `expectedTerm`/`expectedRevision`과 `write_guards`로 보호된다. `commit`이 `history`에 before/after를 남긴다.
- 학생 데이터 처리는 AGENTS.md 기준 고위험이다.

## Selected approach (사용자 결정 2026-11-26)

- **UI**: 기존 학생의 "학생 수정" 창에만 텍스트 버튼 "삭제"를 둔다. 새 학생 추가 창에는 두지 않는다.
  누르면 학번·이름·학적·수강 과목 수를 보이는 확인 창을 띄우고, 확인해야 삭제한다. 학적에 따른 제한은 없다.
  삭제가 끝나면 창을 닫고 목록에서 그 학생을 뺀다. 현재 필터와 페이지는 유지하고 저장 상태를 알린다.
  공통 UI 규칙을 따른다: 텍스트 버튼, 회색조, Pretendard, 불필요한 안내 문구 없음, 키보드·초점 처리, 390px.
- **서버**: 관리자 전용 쓰기 동작 `deleteStudent({id})`를 추가한다(이름은 구현이 정해도 된다).
  - 운영 학기(`ctx.term`)에서 학생을 읽는다. 없으면 404다.
  - 같은 batch에서 그 학생의 `assignments`와 `students` 행을 지운다. CASCADE에 기대지 말고 명시적으로 지운다.
  - 기존 쓰기 가드와 `commit`을 그대로 쓴다. `parts=['students']`로 학생 리비전을 올린다.
- **이력**: `history`에 action `deleteStudent`를 남긴다. target은 학번과 이름, `before`는 삭제 전 학생 전체(수강 포함), `after`는 `null`이다.
  자동 백업은 만들지 않는다.
- **스터디룸**: `student_people`, `student_person_links`, `sr_members`, `sr_attendance`, `sr_events`는 지우거나 바꾸지 않는다.
  같은 학생 ID를 되살리는 백업 복원만 기존 출석 기록과 다시 연결된다.
  학생 추가나 명부 가져오기로 다시 넣으면 새 학생 ID가 되어 이전 출석 기록과 연결되지 않는다(사용자 결정 2026-11-26).

## Rejected alternatives

- 여러 명 선택 일괄 삭제: 사용자가 한 명씩을 골랐다.
- 재학생 삭제 금지: 사용자가 제한 없음을 골랐다.
- 삭제 전 자동 백업, 또는 이력 없이 삭제: 사용자가 변경 이력 기록을 골랐다.
- 스터디룸 연결·출석까지 지우기: 출석 원부와 백업 복원 때의 재연결을 잃는다.
- 수동 추가·가져오기로 다시 넣을 때도 출석 연결 복구: 스터디룸 연결 규칙을 바꿔야 해서 사용자가 고르지 않았다.
  스터디룸의 다른 학생 연결 API(`linkStudent`)는 화면에서 부르지 않는다.

## Compatibility, privacy and migration risks

- DB 스키마·마이그레이션·백업 형식·ID 규칙은 바꾸지 않는다.
- 삭제 전 학생 정보(이름·수강)는 변경 이력에 남는다. 학생 수정 이력과 같은 수준이다. 기존 백업과 스터디룸 출석 기록에도 남는다.
- 다른 관리자가 같은 학생을 동시에 수정·삭제하면 기존 리비전 충돌(409) 또는 404로 막힌다.
- 이전 백업을 복원하거나 그 학생을 다시 가져오면 학생이 다시 생긴다. 백업 복원과 가져오기의 기존 동작이다.

## Testable acceptance conditions

- API:
  - 관리자 삭제는 학생과 그 학생의 `assignments`를 지운다. 다른 학생과 다른 학기 자료는 그대로다.
  - `history`에 before 전체와 after `null`이 남고 학생 리비전이 오른다.
  - 교사·비인증 요청은 401, 없는 id는 404, 오래된 `expectedRevision`과 다른 `expectedTerm`은 409로 거부한다.
  - 스터디룸 연결·출석 행은 남는다. 삭제 전 백업을 복원하면 같은 학생 ID가 같은 `person_id`로 다시 연결된다.
- 브라우저:
  - 기존 학생 수정 창에만 "삭제"가 있고, 확인 창에서 취소하면 아무것도 바뀌지 않는다.
  - 확인하면 목록에서 빠지고 필터와 페이지가 유지된다. 키보드로 조작할 수 있고 초점이 돌아온다. 390px에서 넘치지 않는다.
- `docs/VALIDATION.md`의 기능·보안 시나리오에 학생 삭제 항목을 추가한다(이 설계 승인으로 허용).
  기존 `pnpm test:all` 전체(UI 규칙 시험 포함)가 통과한다.
