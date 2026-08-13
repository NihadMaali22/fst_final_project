import { FastifyInstance } from 'fastify';
import { readPool } from '../db/pool.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => {
    try {
      const client = await readPool.connect();
      try {
        await client.query('SELECT 1');
      } finally {
        client.release();
      }
      return reply.status(200).send({ status: 'ok', database: 'connected' });
    } catch (err) {
      return reply.status(503).send({ status: 'error', message: 'Database connection check failed' });
    }
  });
}
