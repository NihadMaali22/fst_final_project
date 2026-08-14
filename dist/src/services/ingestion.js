import { validateLogBatch } from '../validators/log-validator.js';
import { writeBuffer } from './write-buffer.js';
/**
 * Synchronous ingestion: validates entries and enqueues them fire-and-forget.
 * Partition creation is handled by the write buffer's flush path.
 * No async work on the hot path — HTTP can respond immediately.
 */
export function processIngestBatch(logs) {
    const { validEntries, rejections } = validateLogBatch(logs);
    if (validEntries.length > 0) {
        // Fire-and-forget: enqueue returns immediately, COPY happens in background
        writeBuffer.enqueue(validEntries);
    }
    const response = {
        accepted: validEntries.length,
    };
    if (rejections.length > 0) {
        response.rejected = rejections;
    }
    return response;
}
