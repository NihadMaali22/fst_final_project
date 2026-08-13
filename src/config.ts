import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  host: process.env.HOST || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL || 'postgres://logs_user:logs_password@localhost:5432/logs_db',
  retentionDays: parseInt(process.env.RETENTION_DAYS || '30', 10),
  authEnabled: process.env.AUTH_ENABLED === 'true',
  loadgenApiKey: process.env.LOADGEN_API_KEY || '',
  writeFlushIntervalMs: parseInt(process.env.WRITE_FLUSH_INTERVAL_MS || '50', 10),
  writeFlushSize: parseInt(process.env.WRITE_FLUSH_SIZE || '5000', 10),
  writeConcurrency: parseInt(process.env.WRITE_CONCURRENCY || '3', 10),
  readPoolSize: parseInt(process.env.READ_POOL_SIZE || '5', 10),
  writePoolSize: parseInt(process.env.WRITE_POOL_SIZE || '3', 10),
};
