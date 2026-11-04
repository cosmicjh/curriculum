CREATE TABLE room_allocations (
 term_id TEXT PRIMARY KEY REFERENCES terms(id),
 content TEXT NOT NULL CHECK(json_valid(content))
);
