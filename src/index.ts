import { config } from './config.js';
import { runMigrations } from './db/migrator.js';
import { preCreatePartitions } from './services/partition-manager.js';
import { seedLoadgenKey } from './middleware/auth.js';
import { startRetentionScheduler, stopRetentionScheduler } from './services/retention.js';
import { writeBuffer } from './services/write-buffer.js';
import { closePools } from './db/pool.js';
import { buildApp } from './app.js';

process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught exception:', err);
  process.exit(1);
});

async function startServer(): Promise<void> {
  try {
    console.log('[Server] Initializing Log Ingestion & Query Service...');

    // 1. Run database schema migrations
    await runMigrations();

    // 2. Pre-create daily partitions (past 7 days, today, next 7 days)
    await preCreatePartitions(7, 7);

    // 3. Seed API key if Auth is enabled
    if (config.authEnabled && config.loadgenApiKey) {
      await seedLoadgenKey();
    }

    // 4. Start retention scheduler
    startRetentionScheduler();

    // 5. Build and start Fastify app
    const app = buildApp();

    await app.listen({ port: config.port, host: config.host });
    console.log(`[Server] Ready and listening on http://${config.host}:${config.port}`);

    // Graceful shutdown handling
    const shutdown = async (signal: string) => {
      console.log(`[Server] Received ${signal}, starting graceful shutdown...`);
      stopRetentionScheduler();
      await app.close();
      await writeBuffer.flushAll();
      await closePools();
      console.log('[Server] Graceful shutdown complete.');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    console.error('[Server] Startup failed:', err);
    process.exit(1);
  }
}

startServer();
