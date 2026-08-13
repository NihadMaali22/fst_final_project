export function isValidIso8601(str) {
    if (typeof str !== 'string')
        return false;
    if (str.trim().length === 0)
        return false;
    const d = new Date(str);
    if (isNaN(d.getTime()))
        return false;
    // Additional ISO 8601 format check to ensure strict standard compliant strings
    // ISO 8601 regex pattern matching YYYY-MM-DDTHH:mm:ss.sssZ or similar offset
    const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/i;
    return isoPattern.test(str);
}
export function isFutureTimestamp(date, maxFutureMs = 300_000) {
    return date.getTime() > Date.now() + maxFutureMs;
}
export function parseIsoDate(str) {
    if (!isValidIso8601(str))
        return null;
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
}
export function bucketToPostgresInterval(bucket) {
    switch (bucket) {
        case '1m':
            return '1 minute';
        case '5m':
            return '5 minutes';
        case '1h':
            return '1 hour';
        case '1d':
            return '1 day';
    }
}
