# 전환 구조와 기존 기능 대응

현재 접속 주소는 GitHub Pages입니다. [GitHub 화면과 Workers API의 인증·출처 분리](GITHUB_PAGES_2026-11-02.md)를 함께 확인하세요. 아래 쿠키 설명은 Workers 직접 접속에 해당하고 GitHub 화면에는 탭 메모리 세션이 적용됩니다.

## 확인한 원본

- 실제 작업 원본: `https://github.com/cosmicjh/curriculum`, 커밋 `bd6e7db`.
- 화면: index/student/teacher/admin.html, assets/app.js·import.js·assets.js·style.css.
- 첨부 Code.gs: Apps Script API, Google 시트의 학기별 저장·수정 보호·이력·백업·인증.
- 첨부 Core.gs: 교사 엑셀 열 자동 감지, 분반 자동 연결, 시간블록 추론, 학생·교사 시간표, 명렬표, 검증.
- App.html은 제공되지 않았지만 GitHub 원본 네 HTML과 JS가 확보되어 그대로 재사용했습니다. 프리텐다드는 기존 HTML의 data URL에 내장되어 있습니다.

Code.gs 전체를 서버에서 흉내 내지 않고 저장·권한·캐시·잠금을 다시 구현했습니다. Core.gs는 CommonJS 내보내기만 ESM으로 바꿔 계산 본문을 보존했습니다. 원본 계산의 가상 결과와 SHA-256 출처는 tests/fixtures/legacy-results.json에 있습니다. 운영 자료는 포함하지 않습니다.

## API 대응

모든 업무 요청은 `POST /api/{action}`, JSON 본문을 사용합니다. 성공은 `{ok:true,data}`, 오류는 `{ok:false,code,error}`와 HTTP 오류 상태입니다. 응답은 `Cache-Control: no-store`입니다. Worker 자체 출처 또는 설정된 GitHub 출처의 요청만 허용합니다. Workers 직접 접속은 HttpOnly 쿠키, GitHub 화면은 메모리에만 보관하는 세션을 사용합니다.

| 기존 Code.gs action | 권한 / 새 동작 |
| --- | --- |
| bootstrap, student | 익명, 설정 또는 요청한 재학생 한 명의 시간표만 반환 |
| login, logout | 솔트·비밀번호 계산값 확인 / 해당 브라우저의 교사·관리자 세션 폐기 |
| teacherBootstrap, teacher | 교사 이상, 교사 목록·조건부 분반 목록 / 교사 시간표 |
| roster, classBatch | 교사 이상, 분반·학급 조건 SQL / 재학생 학급 시간표 묶음 |
| adminBootstrap | 관리자, 학생 요약 목록만; 배정·수업·백업 본문 제외 |
| adminStudent, adminSections | 관리자, 학생 한 명·배정 / 버전이 바뀐 분반만 |
| adminLinks, adminLessons | 관리자, 연결·블록 / 선택한 교사의 수업 |
| adminHistory, adminSettings | 관리자, 최근 이력·백업 메타·학기 / 설정 |
| dashboard | 관리자, 전체 자료의 호환 응답; 일반 초기 화면에서는 호출하지 않음 |
| previewImport, commitImport | 관리자, 미리보기 검증 / 보호된 재등록·등록 전 백업 |
| saveStudent, saveSection | 관리자, 학생·수강 배정 / 분반·관련 학생만 수정 |
| saveOverride, saveBlock, saveBlocks | 관리자, 수동 연결 / 시간블록 수정 |
| saveSettings, switchTerm | 관리자, 학기 설정·생성 / 활성 학기 전환 |
| backup, restore | 관리자, 새 백업 생성·다운로드 / 기존 v1 백업 복원·복원 전 백업 |
| changePassword | 관리자, 현재 관리자 비밀번호 재확인·대상 역할 세션 모두 폐기 |

새 API는 `POST /api/passwordParameters`(공개 salt·반복수·인증 버전), `POST /api/downloadBackup`(관리자, 선택 백업 본문), `GET /api/health`(DB 스키마 연결 확인)입니다. 존재하지 않는 `/api/*`는 HTML 대신 404 JSON을 반환합니다.

## 기능·화면

학생·교사 진입, 별도 관리자, 개인시간표, 수업 클릭 명렬표, 교과 명렬표, 학급 A4 4분할·일반·명렬표 인쇄, PNG 저장은 기존 UI를 사용합니다. 선택분반·교실·축약명·수업 연결·시간블록·창체·요일별 교시·학기 전환도 기존 화면에 연결했습니다.

엑셀은 전체교사시간표 1개, 선택과목정보 1개, 학생 배정 자료 3개를 원래 형식 그대로 읽습니다. 3학년 2단위·3단위의 학생은 원본 학번으로 합치고 과목별 배정이 충돌하면 미리보기 단계에서 거부합니다. 한 파일에만 있는 학생은 보존합니다. 전체교사시간표만 선택하면 학생·배정·분반은 바꾸지 않습니다.

2+1학점의 동일 분반 수업, 자동/수동 연결, 공강의 빈 셀 표시, 재학 상태에 따른 명렬표 제외 규칙은 Core.gs 그대로입니다. 연결 설정 메뉴와 HTML 저장 기능을 추가하지 않았습니다.

로딩 중 기존 inert·disabled·MutationObserver 잠금을 보존했고 finally에서 해제합니다. 실패한 저장은 폼을 다시 만들지 않습니다. 탭·자료 로딩으로 폼이 다시 만들어질 때 미저장 값·선택 파일을 학기/폼/학생 ID별 메모리 초안으로 보존합니다. 비밀번호는 초안에 저장하지 않으며 로그아웃 시 초안을 폐기합니다. 학생 자료를 localStorage에 저장하지 않습니다.

## D1 테이블

| 테이블 | 저장 범위 |
| --- | --- |
| terms, app_state | 학기별 설정·자료 버전·활성 학기·전체 변경 버전 |
| students | 복합키 (학기, 내부 ID), 원본학번, 현재 학급·번호·이름·학적·수정 보호 목록 |
| assignments | (학기, 학생 ID, 과목)별 분반 코드·분반 ID; 과목별 미배정도 보존 |
| sections | 내부 분반 ID·원본 연결키·과목·교실·축약명·수정 보호 목록 |
| teachers, lessons | 교사와 요일·교시별 원본 수업 배치 |
| teacher_rows | 원본 엑셀의 행별 데이터; 계산·백업 형식을 위해 보존 |
| overrides, blocks | 수동 연결과 학년·요일·교시별 시간블록 |
| history | 같은 변경 트랜잭션의 변경 전·후 값과 관련 백업 ID |
| backups, backup_parts | 백업별 메타 한 행 / 작은 조각으로 나눈 스냅샷 본문 |
| credentials, sessions, login_limits | 인증값·역할별 인증 버전·만료 세션·로그인 제한 |
| write_guards | 트랜잭션에서 버전·학기·관리자 세션을 다시 확인하는 일시 가드 |

학기·재학생 학번·학급·원본학번·분반·과목별 수강 배정·이력·백업에 SQL 인덱스가 있습니다. 학생 조회·명렬표는 조건에 해당하는 학생만 읽고 반환합니다. 학생 한 명 저장은 해당 학생과 배정만 갱신합니다. 전체 JSON을 매 요청마다 읽고 덮어쓰지 않습니다. 자료 등록·복원 때만 해당 학기 관련 테이블을 일괄 갱신합니다.

모든 쓰기는 활성 학기와 필수 expectedRevision/expectedTerm을 확인합니다. D1 batch 내 가드 트리거가 동시 변경이나 세션 폐기를 발견하면 전체를 중단하여 이력·백업·배정까지 롤백합니다. 성공 시 가드는 제거됩니다. 분반 변경은 관련 학생에게만 반영하고 원본학번·학생 ID를 유지합니다. 읽기 중 자료 버전이 달라지면 결과를 버리고 클라이언트가 한 번 다시 조회합니다. 학기가 바뀌면 기존 학기의 초안을 다른 학기 데이터에 적용하지 않습니다.

## 인증

브라우저 Web Crypto에서 공개 salt로 PBKDF2-SHA-256 100,000회를 계산하고, 서버가 PASSWORD_PEPPER로 역할·salt·계산값에 HMAC-SHA-256을 적용하여 D1의 검증값과 비교합니다. 초기 해시는 CLI에서 생성합니다. 평문 비밀번호·브라우저 계산값 자체는 DB에 보관하지 않습니다. 계산값도 비밀번호에 준하므로 HTTPS로만 전송하며 기록하지 않습니다.

256비트 무작위 세션 토큰은 쿠키 `__Host-tt_teacher` / `__Host-tt_admin`에만 저장합니다. HttpOnly·Secure·SameSite=Strict·Path=/를 사용하고 DB에는 SHA-256 해시만 저장합니다. 세션 수명은 교사 6시간, 관리자 2시간입니다. sessionStorage에는 화면 표시용 `cookie` 표식·역할·만료 시각만 둡니다. 표식을 조작해도 서버 권한을 얻지 못합니다.

로그인 실패는 해당 브라우저의 기존 세션을 폐기합니다. 로그아웃도 서버 세션을 제거합니다. 비밀번호 변경은 대상 역할의 모든 세션을 제거하고 인증 버전을 올립니다. 새 DB 초기화만 1234/1234이며 `INSERT OR IGNORE`로 변경된 비밀번호를 덮어쓰지 않습니다. 로그인·비밀번호 재확인은 IP당 분당 10회, 학생 조회는 IP당 분당 60회입니다. 헤더·성능 로그·백업에 비밀값을 포함하지 않습니다.
