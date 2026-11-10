ALTER TABLE sr_schedules ADD COLUMN term_id TEXT REFERENCES terms(id);
UPDATE sr_schedules SET term_id=(SELECT active_term FROM app_state WHERE id=1);
CREATE INDEX sr_schedule_term_effective ON sr_schedules(term_id,effective_date DESC,version DESC);
CREATE INDEX sr_attendance_term_session ON sr_attendance(term_id,session_id);
CREATE TABLE sr_term_policy(term_id TEXT PRIMARY KEY REFERENCES terms(id),enabled INTEGER NOT NULL CHECK(enabled IN (0,1)));
INSERT INTO sr_term_policy SELECT a.active_term,s.enabled FROM app_state a CROSS JOIN sr_state s WHERE a.id=1 AND s.id=1;
