import { executeQueryLogs, QueryValidationError } from '../services/query-builder.js';
export async function queryRoutes(app) {
    app.get('/logs', async (request, reply) => {
        try {
            const queryParams = request.query;
            const response = await executeQueryLogs(queryParams);
            return reply.status(200).send(response);
        }
        catch (err) {
            if (err instanceof QueryValidationError) {
                return reply.status(400).send({ error: err.message });
            }
            throw err;
        }
    });
}
