// Loopback-only synthetic preview. Never connects to a remote D1 or Apps Script.
import {harness} from '../tests/harness.mjs';
import {setupStudyroom} from '../tests/studyroom-fixture.mjs';
import './build.mjs';
const h=await harness({studyroom:true});await setupStudyroom(h);const url=await h.listen();
console.log('가상 검증 전용 · '+url+'/teacher.html');
console.log('학생: '+url+'/studyroom-student.html?seat=99');
console.log('관리자: '+url+'/admin.html');
console.log('공통 교사/관리자: 1234 / 개별 확인자: test.teacher, 가상교사1234');
console.log('가상 학생: 30101, 30102. 종료 시 초기화됩니다.');
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await h.close();process.exit(0);});
