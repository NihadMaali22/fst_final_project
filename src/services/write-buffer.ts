import { from as copyFrom } from 'pg-copy-streams';
import { writePool } from '../db/pool.js';
import { ValidatedLogEntry } from '../models/types.js';
import { config } from '../config.js';

interface PendingBatchItem {
  resolve: () => void;
  reject: (err: Error) => void;
}

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
  private pendingWaiters: PendingBatchItem[] = [];
  private timer: NodeJS.Timeout | null = null;
  private inFlightCount = 0;

  async enqueue(entries: ValidatedLogEntry[]): Promise<void> {
    if (entries.length === 0) return;

    return new Promise<void>((resolve, reject) => {
      this.queue.push(...entries);
      this.pendingWaiters.push({ resolve, reject });

      if (this.queue.length >= config.writeFlushSize && this.inFlightCount < config.writeConcurrency) {
        this.triggerFlush();
      } else if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.triggerFlush();
        }, config.writeFlushIntervalMs);
      }
    });
  }

  private triggerFlush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.queue.length === 0) return;
    if (this.inFlightCount >= config.writeConcurrency) return;

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

  private async executeCopyFlush(entries: ValidatedLogEntry[], waiters: PendingBatchItem[]): Promise<void> {
    let client;
    try {
      client = await writePool.connect();
      const sql = 'COPY logs (timestamp, level, service, message, attributes) FROM STDIN WITH (FORMAT text)';
      const ingesterStream = client.query(copyFrom(sql));

      await new Promise<void>((resolve, reject) => {
        ingesterStream.on('error', (err: Error) => reject(err));
        ingesterStream.on('finish', () => resolve());

        // Build entire payload as a single string buffer to minimize stream.write() calls
        const lines: string[] = new Array(entries.length);
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          lines[i] = `${entry.timestampIso}\t${entry.level}\t${escapeCopyText(entry.service)}\t${escapeCopyText(entry.message)}\t${escapeCopyText(JSON.stringify(entry.attributes))}`;
        }

        // Write as single chunk to reduce syscalls
        const payload = lines.join('\n') + '\n';
        ingesterStream.write(payload);
        ingesterStream.end();
      });

      for (let i = 0; i < waiters.length; i++) {
        waiters[i].resolve();
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('[WriteBuffer] COPY flush failed:', error.message);
      for (let i = 0; i < waiters.length; i++) {
        waiters[i].reject(error);
      }
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  async flushAll(): Promise<void> {
    while (this.queue.length > 0 || this.inFlightCount > 0) {
      this.triggerFlush();
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

export const writeBuffer = new WriteBufferService();
