import { from as copyFrom } from 'pg-copy-streams';
import { writePool } from '../db/pool.js';
import { config } from '../config.js';
import { ensurePartition } from './partition-manager.js';
function escapeCopyText(val) {
    if (!val)
        return '';
    return val
        .replace(/\\/g, '\\\\')
        .replace(/\t/g, '\\t')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}
const MAX_FLUSH_RETRIES = 3;
const RETRY_BACKOFF_BASE_MS = 250;
const RETRY_BACKOFF_MAX_MS = 2000;
const BYTES_PER_ENTRY_OVERHEAD = 96;
function estimateEntryBytes(e) {
    return e.message.length + e.service.length + e.attributesJson.length + BYTES_PER_ENTRY_OVERHEAD;
}
export class WriteBufferService {
    queue = [];
    timer = null;
    inFlightCount = 0;
    queueBytes = 0;
    consecutiveFailures = 0;
    droppedEntryCount = 0;
    /**
     * Fire-and-forget: pushes entries into the queue and returns immediately.
     * The HTTP response is decoupled from the COPY flush — no promise, no waiting.
     * Background flushes drain the queue into Postgres via COPY.
     */
    enqueue(entries) {
        if (entries.length === 0)
            return;
        this.queue.push(...entries);
        for (const e of entries)
            this.queueBytes += estimateEntryBytes(e);
        this.maybeFlush();
    }
    /** Returns true if the in-memory buffer exceeds safe limits (item count or estimated bytes). */
    isOverloaded() {
        return this.queue.length >= config.maxBufferSize || this.queueBytes >= config.maxBufferBytes;
    }
    /** Returns current queue depth for monitoring. */
    get queueSize() {
        return this.queue.length;
    }
    /** Returns count of entries permanently dropped after exhausting flush retries. */
    get droppedCount() {
        return this.droppedEntryCount;
    }
    maybeFlush() {
        // If queue reached batch size and we have concurrency headroom, flush now
        if (this.queue.length >= config.writeFlushSize && this.inFlightCount < config.writeConcurrency) {
            this.startFlush();
        }
        // Otherwise, schedule a timer-based flush if none is pending
        else if (!this.timer && this.queue.length > 0) {
            this.timer = setTimeout(() => {
                this.timer = null;
                this.startFlush();
            }, config.writeFlushIntervalMs);
        }
    }
    startFlush() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.queue.length === 0)
            return;
        if (this.inFlightCount >= config.writeConcurrency)
            return;
        // Take a bounded batch — NOT the entire queue.
        // This prevents a single massive COPY that blocks Postgres for seconds during spikes.
        const batchSize = Math.min(this.queue.length, config.writeFlushSize);
        let entries;
        if (batchSize === this.queue.length) {
            entries = this.queue;
            this.queue = [];
        }
        else {
            entries = this.queue.splice(0, batchSize);
        }
        let batchBytes = 0;
        for (const e of entries)
            batchBytes += estimateEntryBytes(e);
        this.queueBytes -= batchBytes;
        this.inFlightCount++;
        this.executeCopyFlush(entries)
            .then(() => {
            this.consecutiveFailures = 0;
        })
            .catch((err) => {
            console.error('[WriteBuffer] COPY flush failed:', err instanceof Error ? err.message : err);
            this.consecutiveFailures++;
            const retryable = [];
            for (const e of entries) {
                const attempts = (e.flushAttempts ?? 0) + 1;
                if (attempts <= MAX_FLUSH_RETRIES) {
                    e.flushAttempts = attempts;
                    retryable.push(e);
                }
                else {
                    this.droppedEntryCount++;
                }
            }
            if (retryable.length > 0) {
                // Re-queue at the FRONT so retries are prioritized over newer arrivals.
                // Bounded by the existing queue/isOverloaded() cap — no separate unbounded retry buffer.
                this.queue.unshift(...retryable);
                for (const e of retryable)
                    this.queueBytes += estimateEntryBytes(e);
            }
            if (this.droppedEntryCount > 0) {
                console.error(`[WriteBuffer] Permanently dropped ${this.droppedEntryCount} entries total after exceeding ${MAX_FLUSH_RETRIES} retries`);
            }
        })
            .finally(() => {
            this.inFlightCount--;
            if (this.queue.length === 0)
                return;
            if (this.consecutiveFailures > 0) {
                // Back off instead of hot-looping against a database that's still down.
                const backoff = Math.min(RETRY_BACKOFF_BASE_MS * 2 ** (this.consecutiveFailures - 1), RETRY_BACKOFF_MAX_MS);
                if (!this.timer) {
                    this.timer = setTimeout(() => {
                        this.timer = null;
                        this.startFlush();
                    }, backoff);
                }
            }
            else {
                this.maybeFlush();
            }
        });
    }
    async executeCopyFlush(entries) {
        // 1. Ensure partitions exist for all dates in this batch (cache-hit is synchronous)
        const uniqueDates = new Set();
        for (let i = 0; i < entries.length; i++) {
            const d = entries[i].timestamp;
            uniqueDates.add(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        }
        for (const utcMs of uniqueDates) {
            await ensurePartition(new Date(utcMs));
        }
        // 2. COPY data into Postgres
        const client = await writePool.connect();
        try {
            const sql = 'COPY logs (timestamp, level, service, message, attributes) FROM STDIN WITH (FORMAT text)';
            const ingesterStream = client.query(copyFrom(sql));
            await new Promise((resolve, reject) => {
                ingesterStream.on('error', (err) => reject(err));
                ingesterStream.on('finish', () => resolve());
                // Build entire batch as a single string to minimize stream.write() syscalls
                const lines = new Array(entries.length);
                for (let i = 0; i < entries.length; i++) {
                    const entry = entries[i];
                    lines[i] = `${entry.timestampIso}\t${entry.level}\t${escapeCopyText(entry.service)}\t${escapeCopyText(entry.message)}\t${escapeCopyText(entry.attributesJson)}`;
                }
                ingesterStream.write(lines.join('\n') + '\n');
                ingesterStream.end();
            });
        }
        finally {
            client.release();
        }
    }
    /** Drain all buffered entries. Called during graceful shutdown. */
    async flushAll() {
        // Cancel any pending timer
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        // Flush remaining queue
        while (this.queue.length > 0 || this.inFlightCount > 0) {
            if (this.queue.length > 0 && this.inFlightCount < config.writeConcurrency) {
                this.startFlush();
            }
            await new Promise((r) => setTimeout(r, 50));
        }
    }
}
export const writeBuffer = new WriteBufferService();
