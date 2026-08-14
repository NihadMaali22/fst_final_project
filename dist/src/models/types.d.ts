export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface RawLogEntry {
    timestamp?: unknown;
    level?: unknown;
    service?: unknown;
    message?: unknown;
    attributes?: unknown;
}
export interface ValidatedLogEntry {
    timestamp: Date;
    timestampIso: string;
    level: number;
    levelStr: LogLevel;
    service: string;
    message: string;
    attributes: Record<string, string | number | boolean>;
    attributesJson: string;
    flushAttempts?: number;
}
export interface RejectionReason {
    index: number;
    reason: string;
}
export interface IngestBatchRequest {
    logs?: RawLogEntry[];
}
export interface IngestBatchResponse {
    accepted: number;
    rejected?: RejectionReason[];
}
export interface QueryParams {
    service?: string;
    level?: LogLevel;
    since?: string;
    until?: string;
    q?: string;
    limit?: string;
    cursor?: string;
    [key: `attr.${string}`]: string | undefined;
}
export interface AggregateParams {
    since?: string;
    until?: string;
    bucket?: '1m' | '5m' | '1h' | '1d';
    group_by?: 'service' | 'level';
    service?: string;
    level?: LogLevel;
    q?: string;
    [key: `attr.${string}`]: string | undefined;
}
export interface FormattedLogOutput {
    id: string;
    timestamp: string;
    level: LogLevel;
    service: string;
    message: string;
    attributes: Record<string, string | number | boolean>;
}
export interface QueryLogsResponse {
    logs: FormattedLogOutput[];
    next_cursor: string | null;
}
export interface AggregateBucketOutput {
    start: string;
    group: string | null;
    count: number;
}
export interface AggregateLogsResponse {
    buckets: AggregateBucketOutput[];
}
export interface CursorPayload {
    ts: string;
    id: string;
}
