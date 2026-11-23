# Design: 이동수업 배치표 위탁학생 제외 인원·A3 인쇄 용지

Status: Approved by user (2026-11-23)

선행 설계: [allocation-roster-count.md](allocation-roster-count.md)

## Objective and scope

1. 배치표 상단에 '위탁학생 제외' 체크박스를 둔다. 체크하면 각 칸 인원에서 위탁학생 수를 뺀 인원을 표시한다. 명렬표는 체크 여부와 관계없이 기존대로(위탁학생 포함) 출력한다.
2. 'A3 가로'를 선택해 '전체 한 장 인쇄'를 하면 브라우저 인쇄 창의 기본 용지가 A3로 잡히게 한다. A4 선택 시에는 A4가 잡혀야 한다.

## Current system and constraints

- 학생 학적(`students.status`)은 재학·전출·자퇴·휴학·졸업뿐이다. '위탁'은 자유 입력 칸 `students.note`(비고, 최대 500자)에 기록된다고 본다(사용자 확인).
- 인원(`counts`)은 `allocation` 읽기와 `saveAllocation` 응답에 있으며 `roster` elective와 같은 기준(현재 학기, `status='재학'`, `assignments.section_id`)이다.
- 배치표 조회 읽기 행 수 상한 시험이 있다(가상 900명 기준 8,394행). 저장 경로는 8,672행이다.
- 인쇄: `assets/app.js`의 `print(html,'allocation',paper)`가 인쇄 직전에 `<style>@page{size:A3|A4 landscape;margin:6mm}</style>`를 head에 추가한다. 고정 해시 `assets/style.css`에는 전역 `@page{size:A4 portrait;margin:8mm}`가 있다.
- 웹 페이지는 프린터 드라이버의 기본 용지 설정을 직접 바꿀 수 없다. 페이지가 할 수 있는 것은 CSS `@page size`로 원하는 용지를 요청하는 것뿐이다. 실제 선택은 브라우저(Edge/Chrome)와 프린터 드라이버의 지원 범위에 달려 있다.

## Selected approach

- 위탁 판정(사용자 결정): 비고를 앞뒤 공백만 제거했을 때 정확히 '위탁'인 재학 학생이다. 부분 포함('위탁교육' 등)은 위탁으로 보지 않는다.
- 서버: `allocation` 읽기와 `saveAllocation` 응답의 `allocation`에 위탁 인원 맵을 추가한다(예: `consignedCounts: {[sectionId]: number}`). 기존 `counts`는 그대로 둔다.
  - 위탁 인원은 `counts`와 같은 기준에서 위탁 조건만 더한 값이다. 학생 이름과 비고 본문은 응답에 넣지 않는다.
  - 조회 읽기 행 수가 늘지 않게 기존 집계와 합치는 등 최소화한다. 기존 상한 시험을 통과해야 한다.
  - 저장 응답은 기존 `savedAllocationCounts`와 같은 방식(저장 전 읽은 학생 자료)으로 계산한다.
- 화면(`assets/allocations.js`)
  - 상단 검색 영역 옆에 '위탁학생 제외' 체크박스를 둔다. 교사·관리자 모두 표시한다.
  - 체크하면 칸 인원을 `counts - consignedCounts`로 표시한다. 화면과 '전체 한 장 인쇄' 모두 적용한다.
  - 체크 상태는 이 브라우저에 기억한다(localStorage). 저장소 접근이 실패해도 화면은 동작해야 한다.
  - 명렬표 대화상자·명렬표 인쇄·인원 자동 동기화 비교는 항상 전체(위탁 포함) 기준이다. 자동 동기화가 체크 상태 때문에 잘못 동작하지 않게 한다.
- 인쇄 용지: 원인을 조사한 뒤 Edge/Chrome 인쇄 창이 선택한 용지(A3/A4 가로)를 기본으로 잡도록 고친다. 예를 들어 다음을 검토한다.
  - 전역 `@page` 규칙과 동적 `@page` 규칙의 충돌
  - 규칙 삽입 시점
  - 명명된 페이지(`page:`)
  - 고정 해시 CSS는 수정하지 않는다. 브라우저·드라이버 한계로 보장할 수 없는 부분은 문서와 화면 안내 없이 보고로 남긴다.

## Rejected alternatives

- 학적에 '위탁' 상태 추가: DB 마이그레이션과 학적 처리 전반에 영향이 커서 이번 범위가 아니다.
- 비고 부분 포함 판정: 사용자가 정확히 일치를 선택했다.

## Compatibility and risks

- 저장·백업 형식, ID, 스키마는 변경하지 않는다. 위탁 인원은 응답 전용 파생값이다.
- 비고 표기 방식이 학교마다 다르면(예: '위탁 ') 앞뒤 공백 외의 차이는 위탁으로 판정되지 않는다.
- 인쇄 기본 용지는 브라우저와 프린터 드라이버에 따라 다를 수 있다. 프린터가 A3를 지원하지 않으면 A3가 선택되지 않는다.

## Testable acceptance conditions

- API: `consignedCounts[sectionId]`가 해당 분반 명렬표 학생 중 비고가 정확히 '위탁'인 재학 학생 수와 같다. '위탁교육', '위탁 '(공백), 비재학 위탁 학생으로 경계를 확인한다. 저장 응답도 일치한다.
- 성능: 배치표 조회와 저장의 읽기 행 수 상한 시험이 통과한다.
- 브라우저
  - 체크박스를 켜면 화면 인원과 인쇄 HTML 인원이 위탁학생을 뺀 값이 된다.
  - 끄면 전체 인원으로 돌아간다.
  - 새로고침 후 상태가 유지되고, 명렬표 인원은 항상 전체다.
  - 교사와 관리자 모두에서 확인한다.
- 인쇄: A3 선택 시 `@page` 결과가 A3 가로가 된다. Playwright PDF(`preferCSSPageSize`)의 MediaBox가 A3, A4 선택 시 A4다. 인쇄 창 기본 용지에 대한 브라우저별 동작 조사 결과를 보고한다.
- `pnpm test:all` 통과. 검증 계약과 기존 불변조건 시험은 변경하지 않는다.
