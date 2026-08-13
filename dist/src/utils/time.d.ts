export declare function isValidIso8601(str: unknown): boolean;
export declare function isFutureTimestamp(date: Date, maxFutureMs?: number): boolean;
export declare function parseIsoDate(str: string): Date | null;
export declare function bucketToPostgresInterval(bucket: '1m' | '5m' | '1h' | '1d'): string;
