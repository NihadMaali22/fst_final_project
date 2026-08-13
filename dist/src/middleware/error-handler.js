import { QueryValidationError } from '../services/query-builder.js';
import { AggregationValidationError } from '../services/aggregation.js';
export function errorHandler(error, _request, reply) {
    if (error instanceof QueryValidationError || error instanceof AggregationValidationError) {
        reply.status(400).send({ error: error.message });
        return;
    }
    if (error.statusCode === 400 || error.validation) {
        reply.status(400).send({ error: error.message || 'Malformed request' });
        return;
    }
    // Handle JSON parse errors from Fastify body parser
    if (error.name === 'SyntaxError' || error.message.includes('JSON')) {
        reply.status(400).send({ error: 'Malformed JSON payload' });
        return;
    }
    console.error('[Unhandled Error]:', error);
    reply.status(500).send({ error: 'Internal Server Error' });
}
