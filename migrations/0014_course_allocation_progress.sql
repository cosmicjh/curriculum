CREATE TABLE ca_import_progress (
  id INTEGER PRIMARY KEY REFERENCES ca_import(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('copy','copied','verify','verified','release-check','release-ready')),
  table_index INTEGER NOT NULL DEFAULT 0,
  cursor TEXT,
  verified_at INTEGER,
  hash TEXT NOT NULL DEFAULT ''
);

CREATE TABLE ca_import_lock (
  id INTEGER PRIMARY KEY CHECK (id=1),
  token TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  checked_at INTEGER NOT NULL
);

CREATE TRIGGER ca_check_import_lock BEFORE INSERT ON ca_import_lock
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM ca_import m JOIN ca_import_progress p USING(id)
    WHERE m.id=1 AND m.state='paused' AND p.token=NEW.token
  ) THEN RAISE(ABORT,'allocation_import_changed') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM sessions s JOIN credentials c ON c.role=s.role AND c.epoch=s.epoch
    WHERE s.token_hash=NEW.token_hash AND s.role='admin' AND s.expires_at>NEW.checked_at
  ) THEN RAISE(ABORT,'auth_required') END;
END;
