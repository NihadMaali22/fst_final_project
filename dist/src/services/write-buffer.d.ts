import { ValidatedLogEntry } from '../models/types.js';
export declare class WriteBufferService {
    private queue;
    private pendingWaiters;
    private timer;
    private inFlightCount;
    enqueue(entries: ValidatedLogEntry[]): Promise<void>;
    private triggerFlush;
    private executeCopyFlush;
    flushAll(): Promise<void>;
}
export declare const writeBuffer: WriteBufferService;
