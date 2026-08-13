import { processIngestBatch } from '../services/ingestion.js';
export async function ingestRoutes(app) {
    app.post('/logs', async (request, reply) => {
        const body = request.body;
        if (!body || typeof body !== 'object' || !Array.isArray(body.logs)) {
            return reply.status(400).send({
                error: 'Invalid request body. Expected object containing a "logs" array.',
            });
        }
        if (body.logs.length === 0) {
            return reply.status(400).send({
                error: 'Logs array cannot be empty.',
            });
        }
        const result = await processIngestBatch(body.logs);
        if (result.accepted === 0) {
            return reply.status(400).send(result);
        }
        return reply.status(200).send(result);
    });
}
