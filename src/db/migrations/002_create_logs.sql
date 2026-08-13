CREATE TABLE IF NOT EXISTS logs (
    id          BIGINT GENERATED ALWAYS AS IDENTITY,
    timestamp   TIMESTAMPTZ NOT NULL,
    level       SMALLINT NOT NULL,
    service     TEXT NOT NULL,
    message     TEXT NOT NULL,
    attributes  JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (timestamp, id)
) PARTITION BY RANGE (timestamp);

CREATE INDEX IF NOT EXISTS idx_logs_ts_id_cover ON logs (timestamp DESC, id DESC) 
    INCLUDE (service, level);

CREATE INDEX IF NOT EXISTS idx_logs_service ON logs (service, timestamp DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_logs_level ON logs (level, timestamp DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_logs_attrs ON logs USING GIN (attributes jsonb_path_ops)
    WITH (fastupdate = on, gin_pending_list_limit = 65536);

CREATE INDEX IF NOT EXISTS idx_logs_message_trgm ON logs USING GIN (message gin_trgm_ops)
    WITH (fastupdate = on, gin_pending_list_limit = 65536);
