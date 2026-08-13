import Fastify from 'fastify';
import { errorHandler } from './middleware/error-handler.js';
import { authMiddleware } from './middleware/auth.js';
import { healthRoutes } from './routes/health.js';
import { ingestRoutes } from './routes/ingest.js';
import { queryRoutes } from './routes/query.js';
import { aggregateRoutes } from './routes/aggregate.js';
export function buildApp() {
    const app = Fastify({
        logger: false,
        bodyLimit: 50 * 1024 * 1024, // 50MB body limit for large log batches
    });
    app.setErrorHandler(errorHandler);
    // Global preHandler hook for auth validation
    app.addHook('preHandler', authMiddleware);
    // Register routes
    app.register(healthRoutes);
    app.register(ingestRoutes);
    app.register(queryRoutes);
    app.register(aggregateRoutes);
    return app;
}
