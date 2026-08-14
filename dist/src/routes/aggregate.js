import { executeAggregateLogs, AggregationValidationError } from '../services/aggregation.js';
import { writeBuffer } from '../services/write-buffer.js';
export async function aggregateRoutes(app) {
    app.get('/logs/aggregate', async (request, reply) => {
        try {
            // Ensure any buffered writes are flushed before reading
            await writeBuffer.waitForDrain();
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
