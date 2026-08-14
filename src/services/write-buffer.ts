import { from as copyFrom } from 'pg-copy-streams';
import { writePool } from '../db/pool.js';
import { ValidatedLogEntry } from '../models/types.js';
import { config } from '../config.js';
import { ensurePartition } from './partition-manager.js';

function escapeCopyText(val: string): string {
  if (!val) return '';
  return val
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

export class WriteBufferService {
  private queue: ValidatedLogEntry[] = [];
  private timer: NodeJS.Timeout | null = null;
  private inFlightCount = 0;

  /**
   * Fire-and-forget: pushes entries into the queue and returns immediately.
   * The HTTP response is decoupled from the COPY flush — no promise, no waiting.
   * Background flushes drain the queue into Postgres via COPY.
   */
  enqueue(entries: ValidatedLogEntry[]): void {
    if (entries.length === 0) return;
    this.queue.push(...entries);
    this.maybeFlush();
  }

  /** Returns true if the in-memory buffer exceeds safe limits. */
  isOverloaded(): boolean {
    return this.queue.length >= config.maxBufferSize;
  }

  /** Returns current queue depth for monitoring. */
  get queueSize(): number {
    return this.queue.length;
  }

  private maybeFlush(): void {
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

  private startFlush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0) return;
    if (this.inFlightCount >= config.writeConcurrency) return;

    // Take a bounded batch — NOT the entire queue.
    // This prevents a single massive COPY that blocks Postgres for seconds during spikes.
    const batchSize = Math.min(this.queue.length, config.writeFlushSize);
    let entries: ValidatedLogEntry[];
    if (batchSize === this.queue.length) {
      entries = this.queue;
      this.queue = [];
    } else {
      entries = this.queue.splice(0, batchSize);
    }

    this.inFlightCount++;

    this.executeCopyFlush(entries)
      .catch((err) => {
        console.error('[WriteBuffer] COPY flush failed:', err instanceof Error ? err.message : err);
      })
      .finally(() => {
        this.inFlightCount--;
        // If there's still data in the queue, trigger another flush
        if (this.queue.length > 0) {
          this.maybeFlush();
        }
      });
  }

  private async executeCopyFlush(entries: ValidatedLogEntry[]): Promise<void> {
    // 1. Ensure partitions exist for all dates in this batch (cache-hit is synchronous)
    const uniqueDates = new Set<number>();
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

      await new Promise<void>((resolve, reject) => {
        ingesterStream.on('error', (err: Error) => reject(err));
        ingesterStream.on('finish', () => resolve());

        // Build entire batch as a single string to minimize stream.write() syscalls
        const lines: string[] = new Array(entries.length);
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          lines[i] = `${entry.timestampIso}\t${entry.level}\t${escapeCopyText(entry.service)}\t${escapeCopyText(entry.message)}\t${escapeCopyText(JSON.stringify(entry.attributes))}`;
        }
        ingesterStream.write(lines.join('\n') + '\n');
        ingesterStream.end();
      });
    } finally {
      client.release();
    }
  }

  /** Drain all buffered entries. Called during graceful shutdown. */
  async flushAll(): Promise<void> {
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
