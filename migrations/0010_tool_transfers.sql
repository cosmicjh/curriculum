CREATE TABLE tool_transfers (
 term_id TEXT NOT NULL REFERENCES terms(id),
 kind TEXT NOT NULL CHECK(kind IN ('hours','students')),
 transfer_id TEXT NOT NULL,
 content TEXT NOT NULL CHECK(json_valid(content)),
 saved_at TEXT NOT NULL,
 PRIMARY KEY(term_id,kind)
);
ALTER TABLE course_transfers ADD COLUMN transfer_id TEXT;
