-- Pre-aggregated counts, maintained incrementally by the write buffer.
-- An aggregation over a month of raw logs scans ~1M rows and costs enough CPU that,
-- at 1 query/sec on a 1-CPU Postgres, queries queue up and starve COPY ingestion.
-- These tables let the common aggregation shapes (time bucket, optionally grouped or
-- filtered by service/level) read a few hundred rows instead.
--
-- Buckets are epoch-aligned. Aggregation only reads a rollup when the requested bucket
-- boundaries line up with the rollup grid, so results stay exact; anything else
-- (message search, attribute filters, unaligned windows) still reads raw logs.

CREATE TABLE IF NOT EXISTS log_rollup_1m (
    bucket   TIMESTAMPTZ NOT NULL,
    service  TEXT NOT NULL,
    level    SMALLINT NOT NULL,
    count    BIGINT NOT NULL,
    PRIMARY KEY (bucket, service, level)
);

CREATE TABLE IF NOT EXISTS log_rollup_1h (
    bucket   TIMESTAMPTZ NOT NULL,
    service  TEXT NOT NULL,
    level    SMALLINT NOT NULL,
    count    BIGINT NOT NULL,
    PRIMARY KEY (bucket, service, level)
);

-- Backfill anything already stored (no-op on a fresh database).
INSERT INTO log_rollup_1m (bucket, service, level, count)
SELECT date_bin('1 minute'::interval, timestamp, TIMESTAMPTZ 'epoch'), service, level, COUNT(*)
FROM logs
GROUP BY 1, 2, 3
ON CONFLICT (bucket, service, level) DO UPDATE SET count = EXCLUDED.count;

INSERT INTO log_rollup_1h (bucket, service, level, count)
SELECT date_bin('1 hour'::interval, timestamp, TIMESTAMPTZ 'epoch'), service, level, COUNT(*)
FROM logs
GROUP BY 1, 2, 3
ON CONFLICT (bucket, service, level) DO UPDATE SET count = EXCLUDED.count;
