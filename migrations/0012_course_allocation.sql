CREATE TABLE ca_workspace (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload TEXT NOT NULL CHECK (json_valid(payload) AND length(CAST(payload AS BLOB)) <= 1500000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
);
CREATE TABLE ca_sheets (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL CHECK (json_valid(payload) AND length(CAST(payload AS BLOB)) <= 1500000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  identity_hash TEXT NOT NULL DEFAULT '',
  last_operation TEXT,
  request_hash TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE ca_operations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  sheet_id TEXT,
  request_hash TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX ca_operations_expiry ON ca_operations(created_at);
-- JSON preserves the legacy format; this small index also enforces IDs across ca_sheets.
CREATE TABLE ca_entity_ids (
  kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  sheet_id TEXT NOT NULL REFERENCES ca_sheets(id) ON DELETE CASCADE,
  PRIMARY KEY(kind,entity_id)
);
CREATE INDEX ca_entity_sheet ON ca_entity_ids(sheet_id);
CREATE VIEW ca_sheet_entities AS
  SELECT s.id AS sheet_id,'teacher' AS kind,json_extract(e.value,'$.id') AS entity_id FROM ca_sheets s,json_each(s.payload,'$.teachers') e
  UNION ALL SELECT s.id,'course',json_extract(e.value,'$.id') FROM ca_sheets s,json_each(s.payload,'$.courses') e
  UNION ALL SELECT s.id,'group',json_extract(e.value,'$.id') FROM ca_sheets s,json_each(s.payload,'$.groups') e
  UNION ALL SELECT s.id,'unmapped',json_extract(e.value,'$.id') FROM ca_sheets s,json_each(s.payload,'$.unmapped') e
  UNION ALL SELECT s.id,'section',json_extract(slot.value,'$.id') FROM ca_sheets s,json_each(s.payload,'$.groups') grp,json_each(grp.value,'$.slots') slot;
CREATE TRIGGER ca_index_sheet_insert AFTER INSERT ON ca_sheets
BEGIN
  INSERT INTO ca_entity_ids(kind,entity_id,sheet_id) SELECT kind,entity_id,sheet_id FROM ca_sheet_entities WHERE sheet_id=NEW.id;
END;
CREATE TRIGGER ca_index_sheet_update AFTER UPDATE OF payload ON ca_sheets WHEN NEW.identity_hash != OLD.identity_hash
BEGIN
  DELETE FROM ca_entity_ids WHERE sheet_id=NEW.id AND NOT EXISTS (
    SELECT 1 FROM ca_sheet_entities e WHERE e.sheet_id=NEW.id AND e.kind=ca_entity_ids.kind AND e.entity_id=ca_entity_ids.entity_id
  );
  INSERT INTO ca_entity_ids(kind,entity_id,sheet_id)
    SELECT kind,entity_id,sheet_id FROM ca_sheet_entities WHERE sheet_id=NEW.id
    EXCEPT SELECT kind,entity_id,sheet_id FROM ca_entity_ids WHERE sheet_id=NEW.id;
END;
CREATE TRIGGER ca_sheet_operation AFTER UPDATE ON ca_sheets WHEN NEW.last_operation IS NOT NULL
BEGIN
  INSERT INTO ca_operations(id, kind, sheet_id, request_hash, result, created_at)
  VALUES (NEW.last_operation, 'sheet', NEW.id, NEW.request_hash,
          json_object('revision', NEW.revision), NEW.updated_at);
END;
-- A failed version comparison must abort the entire batch, not just update zero rows.
CREATE TABLE ca_write_guards (
  id TEXT PRIMARY KEY,
  global_revision INTEGER,
  sheet_revisions TEXT,
  token_hash TEXT NOT NULL,
  checked_at INTEGER NOT NULL
);
CREATE TRIGGER ca_check_write_guard BEFORE INSERT ON ca_write_guards
BEGIN
  SELECT CASE WHEN NEW.global_revision IS NOT NULL AND NEW.global_revision !=
    COALESCE((SELECT revision FROM ca_workspace WHERE id=1),-1)
    THEN RAISE(ABORT,'global_conflict') END;
  SELECT CASE WHEN NEW.sheet_revisions IS NOT NULL AND EXISTS (
    SELECT 1 FROM json_each(NEW.sheet_revisions) expected LEFT JOIN ca_sheets current ON current.id=expected.key
    WHERE current.revision IS NULL OR current.revision != expected.value
  ) THEN RAISE(ABORT,'sheet_conflict') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM sessions s JOIN credentials c ON c.role=s.role AND c.epoch=s.epoch
    WHERE s.token_hash=NEW.token_hash AND s.role IN ('teacher','admin') AND s.expires_at>NEW.checked_at
  ) THEN RAISE(ABORT,'auth_required') END;
END;
CREATE TABLE ca_term_archives(
  term TEXT NOT NULL,
  sheet_id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  identity_hash TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(term,sheet_id)
);
