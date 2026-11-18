DROP TRIGGER ca_check_thaw_before_release;

CREATE TRIGGER ca_check_thaw_before_release BEFORE INSERT ON ca_import_thaw
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM ca_import m LEFT JOIN ca_import_progress p USING(id)
    WHERE m.id=1 AND (m.state='released' OR p.phase IN ('release-check','release-ready'))
  ) THEN RAISE(ABORT,'allocation_thaw_blocked') END;
  -- The Worker supplies only the authenticated session hash. The D1 operator supplies this marker.
  SELECT CASE WHEN NEW.token_hash<>'wrangler' AND NOT EXISTS (
    SELECT 1 FROM sessions s JOIN credentials c ON c.role=s.role AND c.epoch=s.epoch
    WHERE s.token_hash=NEW.token_hash AND s.role='admin' AND s.expires_at>NEW.checked_at
  ) THEN RAISE(ABORT,'auth_required') END;
END;

-- A request that checked the old freeze before the reservation must not proceed after cleanup.
CREATE TRIGGER ca_invalidate_import_after_thaw AFTER DELETE ON ca_import_thaw
BEGIN
  UPDATE ca_import_progress SET token=lower(hex(randomblob(16))) WHERE id=OLD.id;
END;
