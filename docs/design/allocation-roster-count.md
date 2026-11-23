# Design: 이동수업 배치표 분반 인원·명렬표 연결

Status: Approved by user (2026-11-23)

## Objective and scope

- 이동수업 배치표의 각 배치 칸에 그 분반을 선택한 학생 수를 교사명 아래에 표시한다(교사·관리자 화면, 인쇄 배치표 모두).
- 교사 모드에서 칸의 과목명(과목 + 분반)을 누르면 그 분반 명렬표를 연다.

## Current system and constraints

- 화면: `assets/allocations.js`의 `mountAllocation(root,initial,{admin,...})`. 교사 모드(`admin=false`)는 읽기 전용, 관리자 모드는 칸 전체가 배치 수정 버튼이다. `printTable()`이 인쇄 배치표를 만든다.
- 자료: `src/worker.js`의 `allocation` 읽기는 `{board,sections,meta}`를 돌려주며 인원은 없다. `saveAllocation`은 `allocationReply={board,sections}`를 돌려준다.
- 명렬표: 교사용 `roster` API의 `{kind:'elective',sectionId}`가 `assignments.section_id` + 학생 `status='재학'` 기준으로 분반 명렬표를 돌려준다. `assets/app.js`의 `showRoster(r)`가 명렬표 대화상자(인쇄 포함)를 연다.
- 저장된 배치 칸은 항상 `sectionId`를 가진다(`prepareAllocation`).

## Selected approach

- 서버: `allocation` 읽기 응답과 `saveAllocation` 응답의 `allocation`에 `counts: {[sectionId]: number}`를 추가한다.
  집계 기준은 `roster` elective와 동일(`assignments.section_id`, 학생 `status='재학'`, 현재 학기)하여 표시 인원 = 명렬표 인원을 보장한다.
  저장 응답은 저장 후 상태(새 분반 생성·`assignments.section_id` 재연결 반영) 기준으로 집계한다. 새 권한·DB 스키마·마이그레이션 없음.
- 화면(`assets/allocations.js`):
  - 배치된 칸의 교사명 아래에 `N명`을 표시한다(0명 포함). `sectionId`가 없거나 인원을 모르는 미저장 칸은 인원을 표시하지 않는다.
  - 교사 모드: `과목 분반`을 버튼으로 만들고 누르면 `onRoster(sectionId)` 콜백을 호출한다. 키보드·접근성 이름을 갖춘다.
  - 관리자 모드: 칸 클릭은 기존처럼 배치 수정이다(명렬표 연결 없음). 인원만 표시한다.
  - 인쇄 배치표(`printTable`): 교사명 아래에 인원을 표시한다. 인쇄 양식의 나머지는 유지한다.
  - 새로고침·저장 후 `counts`를 함께 갱신한다.
- `assets/app.js`: `mountAllocation`에 `onRoster`를 넘기고 `call('roster',{query:{kind:'elective',sectionId}},'teacher')` 결과를 `showRoster`로 연다.
- 배치표 전용 CSS 파일(기준 해시가 고정된 `style.css`는 변경하지 않음): 인원 표기는 기존 모노톤·교사명 스타일에 맞춘다(화면·모바일·인쇄).

## Rejected alternatives

- 명렬표를 배치표 응답에 모두 포함: 응답이 커지고 학생 개인정보가 불필요하게 전달된다.
- 관리자 모드에서도 과목명 클릭으로 명렬표: 칸 클릭이 배치 수정과 충돌한다(사용자 범위 밖).

## Compatibility and risks

- 배치표 저장·백업 형식, ID, 버전·충돌 보호는 변경하지 않는다. `counts`는 응답 전용 파생값이며 저장하지 않는다.
- 학생 자료는 인원 수만 추가로 노출되며, 교사·관리자는 이미 명렬표 조회 권한이 있다. 비로그인 접근은 기존대로 거부된다.
- 검색 강조는 칸 텍스트를 사용하므로 인원 텍스트가 포함될 수 있다(숫자 검색 시 부수 일치). 허용.

## Testable acceptance conditions

- API: 교사·관리자의 `allocation` 응답 `counts[sectionId]`가 같은 분반 `roster` elective 학생 수와 같다. 재학이 아닌 학생은 제외된다. 비로그인은 401.
- API: `saveAllocation` 응답의 `allocation.counts`가 저장 후 상태와 일치한다.
- 브라우저(교사): 배치 칸에 교사명 아래 `N명`이 보이고, 과목명 버튼 클릭 시 해당 분반 명렬표 대화상자가 열리며 인원이 일치한다.
- 브라우저(관리자): 인원이 보이고, 칸 클릭은 기존 배치 수정 대화상자를 연다. 저장 후에도 인원이 유지된다.
- 인쇄 배치표 HTML에 인원이 포함된다.
- `pnpm test`, `pnpm test:browser` 통과(기존 검증 계약·불변조건 테스트 무변경).
