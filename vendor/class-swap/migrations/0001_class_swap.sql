CREATE TABLE state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  dataset TEXT CHECK (dataset IS NULL OR json_valid(dataset)),
  revision INTEGER NOT NULL DEFAULT 0,
  data_rev INTEGER NOT NULL DEFAULT 0,
  plan_rev INTEGER NOT NULL DEFAULT 0
);
INSERT INTO state (id) VALUES (1);
CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('active','cancelled')),
  content TEXT NOT NULL CHECK (json_valid(content))
);
CREATE TABLE reservations (
  teacher_id TEXT NOT NULL,
  actual_date TEXT NOT NULL,
  period INTEGER NOT NULL CHECK (period BETWEEN 1 AND 12),
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  PRIMARY KEY (teacher_id, actual_date, period)
);
CREATE INDEX reservations_plan ON reservations(plan_id);
-- A failed compare-and-swap must be a SQL error, not a successful zero-row UPDATE.
-- This CHECK aborts the D1 batch before any plan/reservation/state write can survive.
CREATE TABLE mutation_guard (
  id TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK (valid = 1)
);
CREATE TABLE credentials (
  role TEXT PRIMARY KEY CHECK (role IN ('teacher','admin')),
  salt TEXT NOT NULL,
  digest TEXT NOT NULL,
  epoch TEXT NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  role TEXT NOT NULL REFERENCES credentials(role),
  epoch TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires);
CREATE TABLE login_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  until_ms INTEGER NOT NULL
);
CREATE TABLE imports (
  hash TEXT PRIMARY KEY,
  imported_at TEXT NOT NULL,
  counts TEXT NOT NULL CHECK (json_valid(counts))
);
-- CLI imports may execute multiple SQL statements independently. Stage chunks privately,
-- then apply all operational state in ONE trigger statement so failures roll it all back.
CREATE TABLE import_staging (job_id TEXT NOT NULL, part INTEGER NOT NULL, content TEXT NOT NULL, PRIMARY KEY(job_id,part));
CREATE TABLE initial_import (job_id TEXT PRIMARY KEY, hash TEXT NOT NULL, content TEXT NOT NULL CHECK(json_valid(content)));
CREATE TRIGGER initial_import_empty BEFORE INSERT ON initial_import BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM state WHERE id=1 AND dataset IS NULL AND revision=0)
    OR EXISTS(SELECT 1 FROM plans) THEN RAISE(ABORT,'INITIAL_IMPORT_REQUIRES_EMPTY_DATABASE') END;
END;
CREATE TRIGGER initial_import_apply AFTER INSERT ON initial_import BEGIN
  UPDATE state SET dataset=json_extract(NEW.content,'$.dataset'),revision=revision+1,data_rev=data_rev+1,plan_rev=plan_rev+1 WHERE id=1;
  INSERT INTO plans(id,version,status,content) SELECT json_extract(value,'$.id'),json_extract(value,'$.version'),json_extract(value,'$.status'),value FROM json_each(NEW.content,'$.plans');
  INSERT INTO reservations(teacher_id,actual_date,period,plan_id) SELECT json_extract(value,'$.teacher'),json_extract(value,'$.date'),json_extract(value,'$.period'),json_extract(value,'$.plan') FROM json_each(NEW.content,'$.reservations');
  INSERT INTO imports(hash,imported_at,counts) VALUES(NEW.hash,strftime('%Y-%m-%dT%H:%M:%fZ','now'),json_extract(NEW.content,'$.counts'));
  DELETE FROM import_staging WHERE job_id=NEW.job_id;
  DELETE FROM initial_import WHERE job_id=NEW.job_id;
END;
