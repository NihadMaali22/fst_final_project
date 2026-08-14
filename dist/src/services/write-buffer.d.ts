import { ValidatedLogEntry } from '../models/types.js';
export declare class WriteBufferService {
    private queue;
    private timer;
    private inFlightCount;
    private queueBytes;
    private consecutiveFailures;
    private droppedEntryCount;
    /**
     * Fire-and-forget: pushes entries into the queue and returns immediately.
     * The HTTP response is decoupled from the COPY flush — no promise, no waiting.
     * Background flushes drain the queue into Postgres via COPY.
     */
    enqueue(entries: ValidatedLogEntry[]): void;
    /** Returns true if the in-memory buffer exceeds safe limits (item count or estimated bytes). */
    isOverloaded(): boolean;
    /** Returns current queue depth for monitoring. */
    get queueSize(): number;
    /** Returns count of entries permanently dropped after exhausting flush retries. */
    get droppedCount(): number;
    private maybeFlush;
    private startFlush;
    private executeCopyFlush;
    /** Drain all buffered entries. Called during graceful shutdown. */
    flushAll(): Promise<void>;
}
export declare const writeBuffer: WriteBufferService;
