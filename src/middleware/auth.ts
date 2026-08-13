import { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';
import { readPool } from '../db/pool.js';

const keyCache = new Set<string>();

export async function seedLoadgenKey(): Promise<void> {
  if (!config.loadgenApiKey) return;

  const client = await readPool.connect();
  try {
    const sql = `
      INSERT INTO api_keys (key, name, permissions)
      VALUES ($1, 'loadgen', ARRAY['ingest', 'query'])
      ON CONFLICT (key) DO NOTHING;
    `;
    await client.query(sql, [config.loadgenApiKey]);
    keyCache.add(config.loadgenApiKey);
    console.log('[Auth] Idempotently seeded LOADGEN_API_KEY');
  } catch (err) {
    console.error('[Auth] Failed to seed LOADGEN_API_KEY:', err);
  } finally {
    client.release();
  }
}

export async function verifyApiKey(key: string): Promise<boolean> {
  if (keyCache.has(key)) return true;

  const client = await readPool.connect();
  try {
    const { rows } = await client.query('SELECT key FROM api_keys WHERE key = $1', [key]);
    if (rows.length > 0) {
      keyCache.add(key);
      return true;
    }
    return false;
  } finally {
    client.release();
  }
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // GET /health is ALWAYS unauthenticated
  if (request.url === '/health' || request.url.startsWith('/health?')) {
    return;
  }

  // When AUTH_ENABLED=false, unrecognised or present Authorization headers must be ignored
  if (!config.authEnabled) {
    return;
  }

  let token: string | undefined;

  const authHeader = request.headers['authorization'];
  if (typeof authHeader === 'string') {
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else {
      reply.status(401).send({ error: 'Malformed Authorization header format. Expected Bearer token.' });
      return;
    }
  }

  if (!token) {
    const xApiKey = request.headers['x-api-key'];
    if (typeof xApiKey === 'string' && xApiKey.trim().length > 0) {
      token = xApiKey.trim();
    }
  }

  if (!token) {
    reply.status(401).send({ error: 'Missing API key credential' });
    return;
  }

  const isValid = await verifyApiKey(token);
  if (!isValid) {
    reply.status(401).send({ error: 'Invalid API key' });
    return;
  }
}
