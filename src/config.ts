import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  host: process.env.HOST || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL || 'postgres://logs_user:logs_password@localhost:5432/logs_db',
  retentionDays: parseInt(process.env.RETENTION_DAYS || '30', 10),
  authEnabled: process.env.AUTH_ENABLED === 'true',
  loadgenApiKey: process.env.LOADGEN_API_KEY || '',
  writeFlushIntervalMs: parseInt(process.env.WRITE_FLUSH_INTERVAL_MS || '250', 10),
  writeFlushSize: parseInt(process.env.WRITE_FLUSH_SIZE || '6000', 10),
  writeConcurrency: parseInt(process.env.WRITE_CONCURRENCY || '2', 10),
  readPoolSize: parseInt(process.env.READ_POOL_SIZE || '5', 10),
  writePoolSize: parseInt(process.env.WRITE_POOL_SIZE || '4', 10),
  // Deliberately modest. Buffered entries are retained objects, so a large queue grows the
  // heap into GC-pause territory on the 256MB app container — and those pauses show up as
  // multi-second tail latency on both ingestion and queries. 60k absorbs bursts while
  // keeping the heap small; raising it measurably worsened p95.
  maxBufferSize: parseInt(process.env.MAX_BUFFER_SIZE || '60000', 10),
  maxBufferBytes: parseInt(process.env.MAX_BUFFER_BYTES || '104857600', 10),
  // 'grid'  — buckets land on natural boundaries (00:00, 00:01, ...), like Grafana/Loki/
  //           Datadog. Every bucket then lines up with the rollup grid, so aggregations
  //           read pre-aggregated counts instead of scanning raw rows.
  // 'since' — buckets are phased from the `since` argument. Exact, but a fine bucket on an
  //           unaligned window straddles every rollup bucket and forces a full scan.
  aggregateAlignment: process.env.AGGREGATE_ALIGNMENT === 'since' ? 'since' : 'grid',
};
