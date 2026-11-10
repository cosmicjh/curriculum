CREATE TABLE course_transfers(term_id TEXT PRIMARY KEY REFERENCES terms(id),content TEXT NOT NULL CHECK(json_valid(content)),saved_at TEXT NOT NULL);
