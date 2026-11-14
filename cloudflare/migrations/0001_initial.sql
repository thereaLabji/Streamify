CREATE TABLE IF NOT EXISTS streamer_status (
  slug TEXT PRIMARY KEY,
  stream_state TEXT NOT NULL CHECK (stream_state IN ('live', 'offline')),
  stream_title TEXT,
  category TEXT,
  diagnostics_state TEXT NOT NULL DEFAULT 'unknown'
    CHECK (diagnostics_state IN ('healthy', 'issues', 'insufficient_data', 'unknown')),
  rendering_lag_percent REAL,
  encoding_lag_percent REAL,
  network_dropped_frames_percent REAL,
  viewers INTEGER,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_streamer_status_last_seen
  ON streamer_status(last_seen_at);
