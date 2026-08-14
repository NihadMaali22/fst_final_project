import { FastifyInstance } from 'fastify';
import { AggregateParams } from '../models/types.js';
import { executeAggregateLogs, AggregationValidationError } from '../services/aggregation.js';
import { writeBuffer } from '../services/write-buffer.js';

export async function aggregateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/logs/aggregate', async (request, reply) => {
    try {


      const queryParams = request.query as AggregateParams;
      const response = await executeAggregateLogs(queryParams);
      return reply.status(200).send(response);
    } catch (err) {
      if (err instanceof AggregationValidationError) {
        return reply.status(400).send({ error: err.message });
      }
      throw err;
    }
  });
}
