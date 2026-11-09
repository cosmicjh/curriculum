import {readFile,writeFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const file='private/studyroom-test-backup.local.sql',sql=await readFile(file,'utf8'),db=new DatabaseSync(':memory:');
try{
 db.exec(sql);const count=table=>db.prepare('SELECT count(*) n FROM '+table).get().n;
 assert.equal(count('students'),99);assert.equal(count('sr_attendance'),99);assert.equal(count('sr_archives'),1);assert.equal(count('sr_staff'),1);
 assert(db.prepare('PRAGMA table_info(sr_write_guards)').all().some(r=>r.name==='session_id'));
 assert(db.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='sr_check_write'").get().sql.includes('sr_session_closed'));
 assert.equal(db.prepare("SELECT count(*) n FROM sr_sessions WHERE status='closed'").get().n,1);
 assert.equal(db.prepare('SELECT count(*) n FROM sr_attendance a JOIN student_people p ON p.id=a.person_id').get().n,99);
 const archive=db.prepare('SELECT * FROM sr_archives').get();assert.equal(createHash('sha256').update(archive.content).digest('hex'),archive.sha256);assert.equal(JSON.parse(archive.content).length,99);
 db.exec('PRAGMA foreign_keys=ON');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 const report={source:'full SQL export of isolated real Cloudflare D1, synthetic data only',restoreTarget:'fresh in-memory SQLite; not an operating DB restore',sha256:createHash('sha256').update(sql).digest('hex'),students:99,attendance:99,archives:1,staff:1,personLinksValid:true,archiveHashValid:true,foreignKeyErrors:0};
 await writeFile('test-results/studyroom/backup-restore.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{db.close();}
