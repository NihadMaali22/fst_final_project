import { executeAggregateLogs, AggregationValidationError } from '../services/aggregation.js';
export async function aggregateRoutes(app) {
    app.get('/logs/aggregate', async (request, reply) => {
        try {
            const queryParams = request.query;
            const response = await executeAggregateLogs(queryParams);
            return reply.status(200).send(response);
        }
        catch (err) {
            if (err instanceof AggregationValidationError) {
                return reply.status(400).send({ error: err.message });
            }
            throw err;
        }
    });
}
