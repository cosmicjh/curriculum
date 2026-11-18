CREATE TABLE ca_import (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  source_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('paused','released'))
);

CREATE TRIGGER ca_import_requires_empty_target BEFORE INSERT ON ca_import
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM ca_workspace)
    OR EXISTS (SELECT 1 FROM ca_sheets) OR EXISTS (SELECT 1 FROM ca_operations)
    OR EXISTS (SELECT 1 FROM ca_term_archives) OR EXISTS (SELECT 1 FROM ca_write_guards)
    THEN RAISE(ABORT,'allocation_target_not_empty') END;
END;

CREATE TRIGGER ca_import_pause_writes BEFORE INSERT ON ca_write_guards
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM ca_import WHERE state='paused')
    THEN RAISE(ABORT,'allocation_import_paused') END;
END;
