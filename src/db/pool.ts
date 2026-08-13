import pkg from 'pg';
const { Pool } = pkg;
import { config } from '../config.js';

export const readPool = new Pool({
  connectionString: config.databaseUrl,
  max: config.readPoolSize,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export const writePool = new Pool({
  connectionString: config.databaseUrl,
  max: config.writePoolSize,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

readPool.on('error', (err) => {
  console.error('Unexpected error on idle read pool client', err);
});

writePool.on('error', (err) => {
  console.error('Unexpected error on idle write pool client', err);
});

export async function closePools(): Promise<void> {
  await Promise.all([readPool.end(), writePool.end()]);
}
