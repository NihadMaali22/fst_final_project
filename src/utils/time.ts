export function isValidIso8601(str: unknown): boolean {
  if (typeof str !== 'string') return false;
  if (str.trim().length === 0) return false;
  const d = new Date(str);
  if (isNaN(d.getTime())) return false;

  // Accept broad ISO 8601 formats:
  // YYYY-MM-DDTHH:mm:ss
  // YYYY-MM-DDTHH:mm:ssZ
  // YYYY-MM-DDTHH:mm:ss.sssZ
  // YYYY-MM-DDTHH:mm:ss+HH:MM
  // YYYY-MM-DDTHH:mm:ss.sss+HH:MM
  // YYYY-MM-DDTHH:mm:ss+HHMM
  // YYYY-MM-DDTHH:mm:ss.sss+HHMM
  const isoPattern = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i;
  return isoPattern.test(str);
}

export function isFutureTimestamp(date: Date, maxFutureMs = 300_000): boolean {
  return date.getTime() > Date.now() + maxFutureMs;
}

export function parseIsoDate(str: string): Date | null {
  if (!isValidIso8601(str)) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

export function bucketToPostgresInterval(bucket: '1m' | '5m' | '1h' | '1d'): string {
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
