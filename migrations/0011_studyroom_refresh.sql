CREATE TABLE sr_refresh_intervals (
  term_id TEXT PRIMARY KEY REFERENCES terms(id),
  seconds INTEGER NOT NULL CHECK (seconds IN (0, 15, 30, 60, 120, 300))
);
