-- Person links deliberately survive timetable roster replacement and restore.
CREATE TABLE student_people(id TEXT PRIMARY KEY,created_at TEXT NOT NULL);
CREATE TABLE student_person_links(term_id TEXT NOT NULL,student_id TEXT NOT NULL,person_id TEXT NOT NULL REFERENCES student_people(id),PRIMARY KEY(term_id,student_id));
CREATE INDEX person_links_person ON student_person_links(person_id);
INSERT INTO student_people SELECT 'tt:'||term_id||':'||id,coalesce(updated_at,'') FROM students;
INSERT INTO student_person_links SELECT term_id,id,'tt:'||term_id||':'||id FROM students;
CREATE TRIGGER student_person_insert AFTER INSERT ON students BEGIN
 INSERT OR IGNORE INTO student_people(id,created_at) SELECT 'tt:'||NEW.term_id||':'||NEW.id,coalesce(NEW.updated_at,'') WHERE NOT EXISTS(SELECT 1 FROM student_person_links WHERE term_id=NEW.term_id AND student_id=NEW.id);
 INSERT OR IGNORE INTO student_person_links VALUES(NEW.term_id,NEW.id,'tt:'||NEW.term_id||':'||NEW.id);
END;
CREATE TABLE sr_state(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL DEFAULT 0,policy_revision INTEGER NOT NULL DEFAULT 0,enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),last_run_at TEXT,last_error TEXT);
INSERT INTO sr_state(id) VALUES(1);
CREATE TABLE sr_members(person_id TEXT PRIMARY KEY REFERENCES student_people(id),enabled INTEGER NOT NULL CHECK(enabled IN (0,1)));
CREATE TABLE sr_schedules(id TEXT PRIMARY KEY,effective_date TEXT NOT NULL,definitions TEXT NOT NULL CHECK(json_valid(definitions)),version INTEGER NOT NULL,created_at TEXT NOT NULL,actor TEXT NOT NULL);
CREATE INDEX sr_schedule_effective ON sr_schedules(effective_date DESC,version DESC);
CREATE TABLE sr_staff(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL,epoch INTEGER NOT NULL DEFAULT 1,enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)));
CREATE TABLE sr_staff_sessions(token_hash TEXT PRIMARY KEY,staff_id TEXT NOT NULL REFERENCES sr_staff(id),epoch INTEGER NOT NULL,origin TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE INDEX sr_staff_expiry ON sr_staff_sessions(expires_at);
CREATE TABLE sr_sessions(id TEXT PRIMARY KEY,date TEXT NOT NULL,label TEXT NOT NULL,academic_year INTEGER NOT NULL,schedule_id TEXT NOT NULL REFERENCES sr_schedules(id),starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),closed_at TEXT);
CREATE INDEX sr_session_closing ON sr_sessions(status,ends_at);
CREATE INDEX sr_session_date ON sr_sessions(date);
CREATE TABLE sr_attendance(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sr_sessions(id),person_id TEXT NOT NULL REFERENCES student_people(id),term_id TEXT NOT NULL,student_id TEXT NOT NULL,student_number TEXT NOT NULL,name TEXT NOT NULL,seat TEXT NOT NULL CHECK(length(seat)=2 AND seat BETWEEN '01' AND '99'),state TEXT NOT NULL CHECK(state IN ('active','cancelled')),first_at TEXT NOT NULL,last_at TEXT NOT NULL,confirmed_by TEXT,confirmed_name TEXT,confirmed_at TEXT,version INTEGER NOT NULL,UNIQUE(session_id,person_id));
CREATE UNIQUE INDEX sr_occupied_seat ON sr_attendance(session_id,seat) WHERE state='active';
CREATE INDEX sr_attendance_person ON sr_attendance(person_id,session_id);
CREATE TABLE sr_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,request_id TEXT NOT NULL UNIQUE,fingerprint TEXT NOT NULL,action TEXT NOT NULL,session_id TEXT,person_id TEXT,at TEXT NOT NULL,actor TEXT NOT NULL,reason TEXT NOT NULL,record TEXT NOT NULL CHECK(json_valid(record)));
CREATE INDEX sr_events_person ON sr_events(person_id,at);
CREATE INDEX sr_events_session ON sr_events(session_id,seq);
CREATE TABLE sr_archives(session_id TEXT PRIMARY KEY REFERENCES sr_sessions(id),content TEXT NOT NULL CHECK(json_valid(content)),sha256 TEXT NOT NULL,record_count INTEGER NOT NULL,created_at TEXT NOT NULL);
CREATE TRIGGER sr_archive_before_close BEFORE UPDATE OF status ON sr_sessions WHEN NEW.status='closed' AND OLD.status='open' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sr_archives a WHERE a.session_id=NEW.id AND a.record_count=(SELECT count(*) FROM sr_attendance WHERE session_id=NEW.id) AND json_array_length(a.content)=a.record_count AND length(a.sha256)=64) THEN RAISE(ABORT,'sr_archive_required') END;
END;
CREATE TABLE sr_write_guards(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,policy_revision INTEGER NOT NULL,tt_revision INTEGER NOT NULL,term_id TEXT NOT NULL,at INTEGER NOT NULL,kind TEXT NOT NULL,token_hash TEXT,origin TEXT,record_id TEXT,record_version INTEGER);
CREATE TRIGGER sr_check_write BEFORE INSERT ON sr_write_guards BEGIN
 SELECT CASE WHEN (NEW.kind!='student' AND NEW.revision!=(SELECT revision FROM sr_state WHERE id=1)) OR NEW.policy_revision!=(SELECT policy_revision FROM sr_state WHERE id=1) OR NEW.tt_revision!=(SELECT revision FROM app_state WHERE id=1) OR NEW.term_id!=(SELECT active_term FROM app_state WHERE id=1) THEN RAISE(ABORT,'sr_revision_conflict') END;
 SELECT CASE WHEN NEW.kind='student' AND NEW.record_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM sr_attendance WHERE id=NEW.record_id AND version=NEW.record_version) THEN RAISE(ABORT,'sr_record_conflict') END;
 SELECT CASE WHEN NEW.kind='staff' AND NOT EXISTS(SELECT 1 FROM sr_staff_sessions s JOIN sr_staff u ON u.id=s.staff_id WHERE s.token_hash=NEW.token_hash AND s.origin=NEW.origin AND s.epoch=u.epoch AND u.enabled=1 AND s.expires_at>NEW.at) THEN RAISE(ABORT,'sr_staff_required') END;
 SELECT CASE WHEN NEW.kind='admin' AND NOT EXISTS(SELECT 1 FROM sessions s JOIN credentials c ON c.role=s.role AND c.epoch=s.epoch WHERE s.token_hash=NEW.token_hash AND s.role='admin' AND s.expires_at>NEW.at) THEN RAISE(ABORT,'auth_required') END;
END;
