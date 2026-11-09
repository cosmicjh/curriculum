-- Unrelated arrivals must not prevent teachers confirming a different student.
ALTER TABLE sr_write_guards ADD COLUMN session_id TEXT;
DROP TRIGGER sr_check_write;
CREATE TRIGGER sr_check_write BEFORE INSERT ON sr_write_guards BEGIN
 SELECT CASE WHEN (NEW.kind NOT IN ('student','staff') AND NEW.revision!=(SELECT revision FROM sr_state WHERE id=1)) OR NEW.policy_revision!=(SELECT policy_revision FROM sr_state WHERE id=1) OR NEW.tt_revision!=(SELECT revision FROM app_state WHERE id=1) OR NEW.term_id!=(SELECT active_term FROM app_state WHERE id=1) THEN RAISE(ABORT,'sr_revision_conflict') END;
 SELECT CASE WHEN NEW.kind IN ('student','staff') AND NEW.record_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM sr_attendance WHERE id=NEW.record_id AND version=NEW.record_version) THEN RAISE(ABORT,'sr_record_conflict') END;
 SELECT CASE WHEN NEW.session_id IS NOT NULL AND EXISTS(SELECT 1 FROM sr_sessions WHERE id=NEW.session_id AND status='closed') THEN RAISE(ABORT,'sr_session_closed') END;
 SELECT CASE WHEN NEW.kind='staff' AND NOT EXISTS(SELECT 1 FROM sr_staff_sessions s JOIN sr_staff u ON u.id=s.staff_id WHERE s.token_hash=NEW.token_hash AND s.origin=NEW.origin AND s.epoch=u.epoch AND u.enabled=1 AND s.expires_at>NEW.at) THEN RAISE(ABORT,'sr_staff_required') END;
 SELECT CASE WHEN NEW.kind='admin' AND NOT EXISTS(SELECT 1 FROM sessions s JOIN credentials c ON c.role=s.role AND c.epoch=s.epoch WHERE s.token_hash=NEW.token_hash AND s.role='admin' AND s.expires_at>NEW.at) THEN RAISE(ABORT,'auth_required') END;
END;
