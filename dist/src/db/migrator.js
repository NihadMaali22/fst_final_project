import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { readPool } from './pool.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export async function runMigrations() {
    const client = await readPool.connect();
    try {
        await client.query(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
        // Find migrations folder
        let migrationsDir = path.join(__dirname, 'migrations');
        try {
            await fs.access(migrationsDir);
        }
        catch {
            // Fallback for dist/build paths
            migrationsDir = path.join(process.cwd(), 'dist', 'src', 'db', 'migrations');
            try {
                await fs.access(migrationsDir);
            }
            catch {
                migrationsDir = path.join(process.cwd(), 'src', 'db', 'migrations');
            }
        }
        const files = await fs.readdir(migrationsDir);
        const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort();
        const { rows: appliedRows } = await client.query('SELECT name FROM _schema_migrations');
        const appliedSet = new Set(appliedRows.map((r) => r.name));
        for (const file of sqlFiles) {
            if (!appliedSet.has(file)) {
                const filePath = path.join(migrationsDir, file);
                const sql = await fs.readFile(filePath, 'utf8');
                await client.query('BEGIN');
                try {
                    await client.query(sql);
                    await client.query('INSERT INTO _schema_migrations (name) VALUES ($1)', [file]);
                    await client.query('COMMIT');
                    console.log(`[Migration] Applied ${file}`);
                }
                catch (err) {
                    await client.query('ROLLBACK');
                    console.error(`[Migration] Failed to apply ${file}:`, err);
                    throw err;
                }
            }
        }
    }
    finally {
        client.release();
    }
}
