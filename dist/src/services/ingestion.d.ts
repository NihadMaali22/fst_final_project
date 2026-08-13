import { RawLogEntry, IngestBatchResponse } from '../models/types.js';
export declare function processIngestBatch(logs: RawLogEntry[]): Promise<IngestBatchResponse>;
