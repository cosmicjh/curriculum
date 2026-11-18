CREATE TABLE ca_import_thaw (
  id INTEGER PRIMARY KEY CHECK (id=1),
  token TEXT NOT NULL,
  generation TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  checked_at INTEGER NOT NULL
);

CREATE TRIGGER ca_check_thaw_before_release BEFORE INSERT ON ca_import_thaw
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM ca_import m LEFT JOIN ca_import_progress p USING(id)
    WHERE m.id=1 AND (m.state='released' OR p.phase IN ('release-check','release-ready'))
  ) THEN RAISE(ABORT,'allocation_thaw_blocked') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM sessions s JOIN credentials c ON c.role=s.role AND c.epoch=s.epoch
    WHERE s.token_hash=NEW.token_hash AND s.role='admin' AND s.expires_at>NEW.checked_at
  ) THEN RAISE(ABORT,'auth_required') END;
END;

CREATE TRIGGER ca_block_import_during_thaw BEFORE INSERT ON ca_import_lock
WHEN EXISTS (SELECT 1 FROM ca_import_thaw WHERE id=1)
BEGIN
  SELECT RAISE(ABORT,'allocation_thaw_active');
END;
