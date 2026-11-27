# Design: 미배정 포함 분반배정 결과 전달

Status: Approved by user (2026-11-27)

## Objective and scope

분반배정 결과에 미배정 학생이 있어도 관리자가 명시적으로 선택하면 다음을 허용한다.
- 시수 자료(JSON 다운로드, 시수배당으로 보내기)
- 학생 배정(미리보기, 다른 학기 저장)

배정 계산·제약, DB 스키마, 마이그레이션은 바꾸지 않는다. 승인된 `section-assignment-term.md`와 `section-assignment-promotion.md`의 결정은 유지한다.

## Current system and constraints

- `assets/section-assignment/app.js`의 결과 후보는 시트 중 하나라도 `validation.complete`가 false이면 "미완성(내보내기 불가)"로 비활성화된다.
  `buildHoursExport`와 `selectedCandidate`도 완전배정 결과만 허용한다. 학생 배정 버튼도 같은 후보 조건을 쓴다.
- 엔진의 `validateResult`는 제약 위반을 `ok:false`로 따로 표시한다. 미배정만 있으면 `ok:true, complete:false`이다.
  2+1 결합 검증은 `auditCoupledCohorts`가 한다.
- 시수배당 가져오기(`modules/allocation/shared/hours-import.js`의 `parse`)는 시트마다
  `validation.complete && hardConstraintsPassed && coupledCohortsPassed`를 요구한다. 이 parse는 다음 세 경로에 공통으로 쓰인다.
  - 서버 `prepareToolTransfer`(`kind:'hours'`)
  - 시수배당 JSON 파일 가져오기
  - 서버 전달본 가져오기
  - 서버 저장본에는 parse 결과가 그대로 남는다.
- 학생 배정 전달(`studentRows`)은 과목별 분반 코드가 `^[A-Z]+[0-9]*$`여야 한다.
  플랫폼 연결(`prepareImport` assignmentOnly)은 전달된 과목만 바꾸고 다른 과목의 기존 배정은 그대로 둔다.

## Selected approach (사용자 결정 2026-11-27)

### 분반배정 화면

- "배정 결과 전달" 카드에 체크박스 "미배정이 있어도 내보내기"를 둔다. 정확한 문구는 짧게 조정할 수 있다.
  - 기본은 꺼짐이다. 페이지 메모리에만 두고, 새로고침하면 꺼진다.
  - 이 체크박스를 바꿔도 계산 결과를 무효화하지 않는다.
  - 계산·전송·학기 확인 중 잠금은 기존 규칙을 따른다.
- 체크박스를 켜면 미배정이 있는 후보도 선택할 수 있다.
  - 표시는 "N순위 · 미배정 X명/Y과목"처럼 전체 미배정 학생 수와 빠진 과목 수를 보인다.
  - 완전배정 후보 표시는 그대로다.
  - 체크박스를 끄면 기존처럼 미완성 후보를 비활성화하고, 선택이 미완성 후보였으면 첫 완전배정 후보로 돌린다(없으면 빈 값).
- 체크박스를 켜도 선택한 후보의 모든 시트가 아래를 통과해야 한다. 위반하면 지금처럼 거부한다.
  - 제약 검증 `validation.ok`
  - 2+1 결합 검증
- 결과 엑셀 다운로드는 지금처럼 모든 후보를 내보낸다.

### 시수 자료

- 미배정 포함 후보로 만든 `school-course-hours` v1 자료의 시트 `validation`에는 다음을 넣는다.
  - `complete:false`, `hardConstraintsPassed:true`, `coupledCohortsPassed:true`
  - 선택 필드 `missingChoices`(빠진 수강 신청 수)와 `unassignedStudents`(전체 미배정 학생 수)
- 완전배정 자료는 지금과 같다. 분반 목록, 시수, 학년·코드 변환, 적용 정원은 기존 규칙 그대로다.
  분반 인원(`studentCount`)은 실제 배정 인원이다.
- `hours-import.js` `parse`의 시트 검사
  - 허용: `complete`가 true이거나 false인 시트. 단 `hardConstraintsPassed`와 `coupledCohortsPassed`는 계속 true여야 한다.
  - 거부: 위 두 값 중 하나라도 true가 아닌 시트, `complete`가 boolean이 아닌 시트.
  - 미배정 수 필드는 선택이며, 있으면 0 이상의 정수로 검증한다.
  - parse 결과의 시트에 `complete`와 미배정 수를 남긴다. 서버 저장본과 이후 가져오기에서도 보여야 하기 때문이다.
  - 기존 파일(모든 시트 complete true, 미배정 필드 없음)은 그대로 통과한다.
- 시수배당 가져오기 화면(`modules/allocation/app/workbook.js`의 `hoursImportDialog`)에서
  미배정 포함 시트에 "미배정 X건 포함" 같은 짧은 표시를 둔다. 가져오기 계산(`defaults`·`plan`)은 바꾸지 않는다.

### 학생 배정

- 체크박스를 켜고 미배정 포함 후보를 고르면 학생 배정 미리보기와 다른 학기 저장도 할 수 있다.
- 배정되지 않은 과목은 그 학생의 `choices`에서 뺀다. 빈 코드나 `undefined`를 보내지 않는다.
  - 전체 미배정 학생은 빈 `choices`로 보내지 않고 학생 목록에서 뺀다.
  - 남은 학생이 0명이면 오류다.
- 서버 학생 전달 검증(`studentRows`)과 연결 규칙은 바꾸지 않는다.
  미배정 과목은 전달되지 않으므로 기존 배정이 유지된다.
- 완료·상태 문구에 제외된 과목 수를 짧게 보인다(예: "미배정 Y과목 제외").

## Rejected alternatives

- 학생 배정은 완전배정만 허용: 사용자가 학생 배정도 허용하기로 했다.
- 제약 위반 결과까지 내보내기: 분반·시수의 신뢰성이 깨진다.
- 미배정 과목을 빈 분반 코드로 보내 기존 배정을 지우기: 서버 검증을 바꿔야 하고 수동 배정을 지울 위험이 있다.

## Compatibility, privacy and migration risks

- 스키마, 마이그레이션, 백업 형식, ID, 전달 형식 버전은 바꾸지 않는다. `validation`의 선택 필드만 추가한다.
- 미배정 포함 결과를 시수배당에 반영하면, 미배정 학생 몫의 분반이 빠진 상태로 시수가 확정될 수 있다. 화면 표시로 알린다.
- 학생 배정에서는 미배정 과목이 반영되지 않는다. 연결 후 해당 학생의 과목은 관리자가 직접 확인해야 한다.
- `hours-import.js`의 서버 검증을 완화하는 변경이므로 병합 전에 새 Codex 스레드로 독립 검토한다.

## Testable acceptance conditions

- 분반배정 브라우저 시험
  - 미배정이 생기는 가상 자료에서 체크박스가 꺼져 있으면 기존처럼 내보내기가 비활성이다.
  - 켜면 미배정 후보를 선택해 JSON을 내려받고 시수배당으로 보낼 수 있다.
  - 시트 `validation.complete:false`와 미배정 수가 들어간다.
  - 시수배당 가져오기 화면에 미배정 표시가 나오고 적용된다.
  - 끄면 선택이 완전배정 후보 또는 빈 값으로 돌아간다.
  - 체크박스를 바꿔도 결과가 무효화되지 않는다.
- 같은 자료에서 학생 배정 미리보기와 다른 학기 저장이 미배정 과목을 뺀 채 성공한다.
  - 전체 미배정 학생은 목록에서 빠진다.
  - 학생 미리보기 화면에서 미배정 과목의 기존 배정이 유지된다.
- 제약 위반 후보(`validation.ok:false`)나 결합 검증 실패는 체크박스를 켜도 거부한다.
- 단위·API 시험(`hours-import` parse와 서버 `stageToolTransfer`)
  - 허용: `complete:false` + 두 검증 true 시트, 기존 완전배정 파일
  - 거부: `hardConstraintsPassed` 또는 `coupledCohortsPassed`가 false인 시트, 잘못된 미배정 수
  - 서버 저장본과 `/assignment-hours` 응답에 `complete`와 미배정 수가 남는다.
- 키보드 조작, 390px 가로 넘침 없음, 버튼·체크박스 높이 규칙을 지킨다.
- `pnpm test:all` 전체가 통과한다.
