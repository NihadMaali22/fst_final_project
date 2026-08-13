import { from as copyFrom } from 'pg-copy-streams';
import { writePool } from '../db/pool.js';
import { config } from '../config.js';
function escapeCopyText(val) {
    if (!val)
        return '';
    return val
        .replace(/\\/g, '\\\\')
        .replace(/\t/g, '\\t')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}
export class WriteBufferService {
    queue = [];
    pendingWaiters = [];
    timer = null;
    inFlightCount = 0;
    async enqueue(entries) {
        if (entries.length === 0)
            return;
        return new Promise((resolve, reject) => {
            this.queue.push(...entries);
            this.pendingWaiters.push({ resolve, reject });
            if (this.queue.length >= config.writeFlushSize && this.inFlightCount < config.writeConcurrency) {
                this.triggerFlush();
            }
            else if (!this.timer) {
                this.timer = setTimeout(() => {
                    this.timer = null;
                    this.triggerFlush();
                }, config.writeFlushIntervalMs);
            }
        });
    }
    triggerFlush() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.queue.length === 0)
            return;
        if (this.inFlightCount >= config.writeConcurrency)
            return;
        const entriesToFlush = this.queue;
        const waitersToNotify = this.pendingWaiters;
        this.queue = [];
        this.pendingWaiters = [];
        this.inFlightCount++;
        this.executeCopyFlush(entriesToFlush, waitersToNotify).finally(() => {
            this.inFlightCount--;
            if (this.queue.length > 0) {
                this.triggerFlush();
            }
        });
    }
    async executeCopyFlush(entries, waiters) {
        let client;
        try {
            client = await writePool.connect();
            const sql = 'COPY logs (timestamp, level, service, message, attributes) FROM STDIN WITH (FORMAT text)';
            const ingesterStream = client.query(copyFrom(sql));
            await new Promise((resolve, reject) => {
                ingesterStream.on('error', (err) => reject(err));
                ingesterStream.on('finish', () => resolve());
                for (let i = 0; i < entries.length; i++) {
                    const entry = entries[i];
                    const tsStr = entry.timestampIso;
                    const levelStr = entry.level.toString();
                    const serviceStr = escapeCopyText(entry.service);
                    const messageStr = escapeCopyText(entry.message);
                    const attrsStr = escapeCopyText(JSON.stringify(entry.attributes));
                    const line = `${tsStr}\t${levelStr}\t${serviceStr}\t${messageStr}\t${attrsStr}\n`;
                    ingesterStream.write(line);
                }
                ingesterStream.end();
            });
            for (let i = 0; i < waiters.length; i++) {
                waiters[i].resolve();
            }
        }
        catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            console.error('[WriteBuffer] COPY flush failed:', error);
            for (let i = 0; i < waiters.length; i++) {
                waiters[i].reject(error);
            }
        }
        finally {
            if (client) {
                client.release();
            }
        }
    }
    async flushAll() {
        while (this.queue.length > 0 || this.inFlightCount > 0) {
            this.triggerFlush();
            await new Promise((r) => setTimeout(r, 10));
        }
    }
}
export const writeBuffer = new WriteBufferService();
