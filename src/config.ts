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
  // One COPY at a time: a second concurrent flush measurably slows the aggregation
  // query on a single-CPU Postgres without raising sustained ingestion throughput.
  writeConcurrency: parseInt(process.env.WRITE_CONCURRENCY || '1', 10),
  readPoolSize: parseInt(process.env.READ_POOL_SIZE || '5', 10),
  writePoolSize: parseInt(process.env.WRITE_POOL_SIZE || '4', 10),
  maxBufferSize: parseInt(process.env.MAX_BUFFER_SIZE || '200000', 10),
  maxBufferBytes: parseInt(process.env.MAX_BUFFER_BYTES || '104857600', 10),
};
