CREATE TABLE IF NOT EXISTS api_keys (
    key         TEXT PRIMARY KEY,
    name        TEXT NOT NULL DEFAULT 'default',
    permissions TEXT[] NOT NULL DEFAULT ARRAY['ingest', 'query'],
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
