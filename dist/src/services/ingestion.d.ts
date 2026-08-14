import { RawLogEntry, IngestBatchResponse } from '../models/types.js';
/**
 * Synchronous ingestion: validates entries and enqueues them fire-and-forget.
 * Partition creation is handled by the write buffer's flush path.
 * No async work on the hot path — HTTP can respond immediately.
 */
export declare function processIngestBatch(logs: RawLogEntry[]): IngestBatchResponse;
