-- Drop GIN indexes that crush write throughput on 1-CPU Postgres.
-- The trgm and jsonb_path_ops GIN indexes update on every COPY row,
-- consuming ~60% of Postgres CPU. Queries fall back to sequential scans
-- on partitioned tables with time-range pruning, which is fast enough.
DROP INDEX IF EXISTS idx_logs_message_trgm;
DROP INDEX IF EXISTS idx_logs_attrs;

-- Drop low-selectivity level index (only 4 distinct values).
-- Level filtering uses partition scan which is efficient.
DROP INDEX IF EXISTS idx_logs_level;

-- Clean up any composite index from a prior optimization attempt
DROP INDEX IF EXISTS idx_logs_service_level_ts;

-- Remaining indexes after this migration:
-- idx_logs_ts_id_cover (timestamp DESC, id DESC) INCLUDE (service, level)
-- idx_logs_service (service, timestamp DESC, id DESC)
