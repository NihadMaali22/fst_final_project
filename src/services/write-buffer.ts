import { from as copyFrom } from 'pg-copy-streams';
import { writePool } from '../db/pool.js';
import { ValidatedLogEntry } from '../models/types.js';
import { config } from '../config.js';
import { ensurePartition } from './partition-manager.js';

const NEEDS_COPY_ESCAPE = /[\\\t\n\r]/;

// Building a flush batch runs on the app's 0.5 CPU and blocks the event loop, which
// shows up as tail latency on concurrent queries. Most log text contains none of the
// COPY metacharacters, so test once and skip the four rewrites in that case.
function escapeCopyText(val: string): string {
  if (!val) return '';
  if (!NEEDS_COPY_ESCAPE.test(val)) return val;
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
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

interface RollupDelta {
  bucketMs: number;
  service: string;
  level: number;
  count: number;
}

function estimateEntryBytes(e: ValidatedLogEntry): number {
  return e.message.length + e.service.length + e.attributesJson.length + BYTES_PER_ENTRY_OVERHEAD;
}

/**
 * Counts a batch per (bucket, service, level) at the given resolution.
 * Rows are deduplicated because one INSERT ... ON CONFLICT cannot touch the same
 * row twice, and sorted so concurrent flushes take rollup row locks in the same
 * order and cannot deadlock against each other.
 */
function countByBucket(entries: ValidatedLogEntry[], unitMs: number): RollupDelta[] {
  const counts = new Map<string, RollupDelta>();
  for (const entry of entries) {
    const t = entry.timestamp.getTime();
    const bucketMs = t - (t % unitMs);
    const key = `${bucketMs} ${entry.level} ${entry.service}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count++;
    } else {
      counts.set(key, { bucketMs, service: entry.service, level: entry.level, count: 1 });
    }
  }
  return [...counts.values()].sort(
    (a, b) =>
      a.bucketMs - b.bucketMs ||
      a.level - b.level ||
      (a.service < b.service ? -1 : a.service > b.service ? 1 : 0)
  );
}

export class WriteBufferService {
  private queue: ValidatedLogEntry[] = [];
  private timer: NodeJS.Timeout | null = null;
  private inFlightCount = 0;
  private queueBytes = 0;
  private consecutiveFailures = 0;
  private droppedEntryCount = 0;

  /**
   * Fire-and-forget: pushes entries into the queue and returns immediately.
   * The HTTP response is decoupled from the COPY flush — no promise, no waiting.
   * Background flushes drain the queue into Postgres via COPY.
   */
  enqueue(entries: ValidatedLogEntry[]): void {
    if (entries.length === 0) return;
    this.queue.push(...entries);
    for (const e of entries) this.queueBytes += estimateEntryBytes(e);
    this.maybeFlush();
  }

  /** Returns true if the in-memory buffer exceeds safe limits (item count or estimated bytes). */
  isOverloaded(): boolean {
    return this.queue.length >= config.maxBufferSize || this.queueBytes >= config.maxBufferBytes;
  }

  /** Returns current queue depth for monitoring. */
  get queueSize(): number {
    return this.queue.length;
  }

  /** Returns count of entries permanently dropped after exhausting flush retries. */
  get droppedCount(): number {
    return this.droppedEntryCount;
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
    let batchBytes = 0;
    for (const e of entries) batchBytes += estimateEntryBytes(e);
    this.queueBytes -= batchBytes;

    this.inFlightCount++;

    this.executeCopyFlush(entries)
      .then(() => {
        this.consecutiveFailures = 0;
      })
      .catch((err) => {
        console.error('[WriteBuffer] COPY flush failed:', err instanceof Error ? err.message : err);
        this.consecutiveFailures++;

        const retryable: ValidatedLogEntry[] = [];
        for (const e of entries) {
          const attempts = (e.flushAttempts ?? 0) + 1;
          if (attempts <= MAX_FLUSH_RETRIES) {
            e.flushAttempts = attempts;
            retryable.push(e);
          } else {
            this.droppedEntryCount++;
          }
        }
        if (retryable.length > 0) {
          // Re-queue at the FRONT so retries are prioritized over newer arrivals.
          // Bounded by the existing queue/isOverloaded() cap — no separate unbounded retry buffer.
          this.queue.unshift(...retryable);
          for (const e of retryable) this.queueBytes += estimateEntryBytes(e);
        }
        if (this.droppedEntryCount > 0) {
          console.error(
            `[WriteBuffer] Permanently dropped ${this.droppedEntryCount} entries total after exceeding ${MAX_FLUSH_RETRIES} retries`
          );
        }
      })
      .finally(() => {
        this.inFlightCount--;
        if (this.queue.length === 0) return;

        if (this.consecutiveFailures > 0) {
          // Back off instead of hot-looping against a database that's still down.
          const backoff = Math.min(
            RETRY_BACKOFF_BASE_MS * 2 ** (this.consecutiveFailures - 1),
            RETRY_BACKOFF_MAX_MS
          );
          if (!this.timer) {
            this.timer = setTimeout(() => {
              this.timer = null;
              this.startFlush();
            }, backoff);
          }
        } else {
          this.maybeFlush();
        }
      });
  }

  private async upsertRollup(
    client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
    table: string,
    deltas: RollupDelta[]
  ): Promise<void> {
    if (deltas.length === 0) return;

    const buckets = new Array<string>(deltas.length);
    const services = new Array<string>(deltas.length);
    const levels = new Array<number>(deltas.length);
    const counts = new Array<number>(deltas.length);
    for (let i = 0; i < deltas.length; i++) {
      const d = deltas[i];
      buckets[i] = new Date(d.bucketMs).toISOString();
      services[i] = d.service;
      levels[i] = d.level;
      counts[i] = d.count;
    }

    await client.query(
      `INSERT INTO ${table} (bucket, service, level, count)
       SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::smallint[], $4::bigint[])
       ON CONFLICT (bucket, service, level)
       DO UPDATE SET count = ${table}.count + EXCLUDED.count`,
      [buckets, services, levels, counts]
    );
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

    const minuteDeltas = countByBucket(entries, MINUTE_MS);
    const hourDeltas = countByBucket(entries, HOUR_MS);

    // 2. COPY the rows and apply the rollup deltas atomically, so a failed flush
    //    leaves neither behind and can be retried without double-counting.
    //    The upserts run last, holding rollup row locks only until COMMIT.
    const client = await writePool.connect();
    try {
      await client.query('BEGIN');
      const sql = 'COPY logs (timestamp, level, service, message, attributes) FROM STDIN WITH (FORMAT text)';
      const ingesterStream = client.query(copyFrom(sql));

      await new Promise<void>((resolve, reject) => {
        ingesterStream.on('error', (err: Error) => reject(err));
        ingesterStream.on('finish', () => resolve());

        // Build entire batch as a single string to minimize stream.write() syscalls
        const lines: string[] = new Array(entries.length);
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          lines[i] = `${entry.timestampIso}\t${entry.level}\t${escapeCopyText(entry.service)}\t${escapeCopyText(entry.message)}\t${escapeCopyText(entry.attributesJson)}`;
        }
        ingesterStream.write(lines.join('\n') + '\n');
        ingesterStream.end();
      });

      await this.upsertRollup(client, 'log_rollup_1m', minuteDeltas);
      await this.upsertRollup(client, 'log_rollup_1h', hourDeltas);
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Connection may already be unusable; the original error is what matters.
      }
      throw err;
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
