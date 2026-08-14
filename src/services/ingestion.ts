import { RawLogEntry, IngestBatchResponse } from '../models/types.js';
import { validateLogBatch } from '../validators/log-validator.js';
import { ensurePartition } from './partition-manager.js';
import { writeBuffer } from './write-buffer.js';

export async function processIngestBatch(logs: RawLogEntry[]): Promise<IngestBatchResponse> {
  const { validEntries, rejections } = validateLogBatch(logs);

  if (validEntries.length > 0) {
    // Ensure daily partitions exist for unique dates in this batch
    // This is fast because ensurePartition uses an in-memory cache
    const uniqueDates = new Set<number>();
    for (let i = 0; i < validEntries.length; i++) {
      const d = validEntries[i].timestamp;
      const dateUtcDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      uniqueDates.add(dateUtcDay);
    }

    // Create partitions concurrently (non-blocking for common case where partition exists)
    const partitionPromises: Promise<string>[] = [];
    for (const utcMs of uniqueDates) {
      partitionPromises.push(ensurePartition(new Date(utcMs)));
    }
    await Promise.all(partitionPromises);

    // Write valid logs to DB via writeBuffer
    await writeBuffer.enqueue(validEntries);
  }

  const response: IngestBatchResponse = {
    accepted: validEntries.length,
  };

  if (rejections.length > 0) {
    response.rejected = rejections;
  }

  return response;
}
