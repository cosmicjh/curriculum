CREATE TABLE swap_plans (
 id TEXT PRIMARY KEY,term_id TEXT NOT NULL REFERENCES terms(id),
 version INTEGER NOT NULL CHECK(version>0),status TEXT NOT NULL CHECK(status IN ('active','cancelled')),
 content TEXT NOT NULL CHECK(json_valid(content))
);
CREATE INDEX swap_plan_term ON swap_plans(term_id,id);
CREATE TABLE swap_reservations (
 term_id TEXT NOT NULL REFERENCES terms(id),teacher_id TEXT NOT NULL,actual_date TEXT NOT NULL,
 period INTEGER NOT NULL CHECK(period BETWEEN 1 AND 12),plan_id TEXT NOT NULL REFERENCES swap_plans(id) ON DELETE CASCADE,
 PRIMARY KEY(term_id,teacher_id,actual_date,period)
);
CREATE INDEX swap_reservation_plan ON swap_reservations(plan_id);
CREATE TRIGGER swap_plan_created AFTER INSERT ON swap_plans BEGIN
 INSERT INTO swap_reservations(term_id,teacher_id,actual_date,period,plan_id)
 SELECT NEW.term_id,json_extract(NEW.content,'$.teacherA'),json_extract(value,'$.dateA'),json_extract(value,'$.periodA'),NEW.id FROM json_each(NEW.content,'$.items') WHERE NEW.status='active'
 UNION ALL SELECT NEW.term_id,json_extract(value,'$.teacherB'),json_extract(value,'$.dateA'),json_extract(value,'$.periodA'),NEW.id FROM json_each(NEW.content,'$.items') WHERE NEW.status='active'
 UNION ALL SELECT NEW.term_id,json_extract(NEW.content,'$.teacherA'),json_extract(value,'$.dateB'),json_extract(value,'$.periodB'),NEW.id FROM json_each(NEW.content,'$.items') WHERE NEW.status='active' AND json_extract(value,'$.mode')='swap'
 UNION ALL SELECT NEW.term_id,json_extract(value,'$.teacherB'),json_extract(value,'$.dateB'),json_extract(value,'$.periodB'),NEW.id FROM json_each(NEW.content,'$.items') WHERE NEW.status='active' AND json_extract(value,'$.mode')='swap';
 UPDATE app_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER swap_plan_updated AFTER UPDATE ON swap_plans BEGIN
 DELETE FROM swap_reservations WHERE plan_id=OLD.id;
 INSERT INTO swap_reservations(term_id,teacher_id,actual_date,period,plan_id)
 SELECT NEW.term_id,json_extract(NEW.content,'$.teacherA'),json_extract(value,'$.dateA'),json_extract(value,'$.periodA'),NEW.id FROM json_each(NEW.content,'$.items') WHERE NEW.status='active'
 UNION ALL SELECT NEW.term_id,json_extract(value,'$.teacherB'),json_extract(value,'$.dateA'),json_extract(value,'$.periodA'),NEW.id FROM json_each(NEW.content,'$.items') WHERE NEW.status='active'
 UNION ALL SELECT NEW.term_id,json_extract(NEW.content,'$.teacherA'),json_extract(value,'$.dateB'),json_extract(value,'$.periodB'),NEW.id FROM json_each(NEW.content,'$.items') WHERE NEW.status='active' AND json_extract(value,'$.mode')='swap'
 UNION ALL SELECT NEW.term_id,json_extract(value,'$.teacherB'),json_extract(value,'$.dateB'),json_extract(value,'$.periodB'),NEW.id FROM json_each(NEW.content,'$.items') WHERE NEW.status='active' AND json_extract(value,'$.mode')='swap';
 UPDATE app_state SET revision=revision+1 WHERE id=1;
END;
CREATE TABLE swap_write_guards (
 id TEXT PRIMARY KEY,expected_revision INTEGER NOT NULL,expected_term TEXT NOT NULL,
 token_hash TEXT NOT NULL,at INTEGER NOT NULL
);
CREATE TRIGGER check_swap_write_guard BEFORE INSERT ON swap_write_guards BEGIN
 SELECT CASE WHEN NEW.expected_revision!=(SELECT revision FROM app_state WHERE id=1) OR NEW.expected_term!=(SELECT active_term FROM app_state WHERE id=1) THEN RAISE(ABORT,'revision_conflict') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sessions s JOIN credentials c ON c.role=s.role AND c.epoch=s.epoch WHERE s.token_hash=NEW.token_hash AND s.expires_at>NEW.at) THEN RAISE(ABORT,'auth_required') END;
END;
CREATE TABLE swap_imports (
 source_id TEXT PRIMARY KEY,source_hash TEXT NOT NULL,term_id TEXT NOT NULL REFERENCES terms(id),
 expected_revision INTEGER NOT NULL,plan_count INTEGER NOT NULL,content TEXT CHECK(content IS NULL OR json_valid(content)),imported_at TEXT NOT NULL
);
CREATE TRIGGER check_swap_import BEFORE INSERT ON swap_imports BEGIN
 SELECT CASE WHEN NEW.expected_revision!=(SELECT revision FROM app_state WHERE id=1) OR NEW.term_id!=(SELECT active_term FROM app_state WHERE id=1) OR EXISTS(SELECT 1 FROM swap_plans) THEN RAISE(ABORT,'swap_import_conflict') END;
 SELECT CASE WHEN NEW.plan_count!=json_array_length(NEW.content) THEN RAISE(ABORT,'swap_import_invalid') END;
END;
CREATE TRIGGER apply_swap_import AFTER INSERT ON swap_imports BEGIN
 INSERT INTO swap_plans(id,term_id,version,status,content)
 SELECT json_extract(value,'$.id'),NEW.term_id,json_extract(value,'$.version'),json_extract(value,'$.status'),value FROM json_each(NEW.content);
 UPDATE swap_imports SET content=NULL WHERE source_id=NEW.source_id;
END;
