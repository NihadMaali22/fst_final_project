import { FastifyInstance } from 'fastify';
import { QueryParams } from '../models/types.js';
import { executeQueryLogs, QueryValidationError } from '../services/query-builder.js';

export async function queryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/logs', async (request, reply) => {
    try {
      const queryParams = request.query as QueryParams;
      const response = await executeQueryLogs(queryParams);
      return reply.status(200).send(response);
    } catch (err) {
      if (err instanceof QueryValidationError) {
        return reply.status(400).send({ error: err.message });
      }
      throw err;
    }
  });
}
