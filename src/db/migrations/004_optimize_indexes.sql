-- Drop extremely expensive GIN indexes that crush write throughput
-- The pg_trgm index on message and jsonb_path_ops index on attributes
-- consume massive CPU during COPY inserts (each row updates both GIN indexes)
DROP INDEX IF EXISTS idx_logs_message_trgm;
DROP INDEX IF EXISTS idx_logs_attrs;

-- Drop individual service and level indexes (replaced by composite below)
DROP INDEX IF EXISTS idx_logs_service;
DROP INDEX IF EXISTS idx_logs_level;

-- Single composite index covers service+level filter combinations efficiently
CREATE INDEX IF NOT EXISTS idx_logs_service_level_ts
  ON logs (service, level, timestamp DESC, id DESC);
