import { LogLevel } from '../models/types.js';

// The contract admits exactly four levels. `warning` and `fatal` were previously mapped
// as aliases of `warn` and `error`, which made isValidLogLevel accept them — so an entry
// carrying `"level": "fatal"` was silently stored as `error` instead of being rejected
// with a reason, and `?level=warning` was answered instead of returning 400. Aliases
// belong nowhere in a validator whose job is to reject anything off-contract.
const LEVEL_MAP: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const REVERSE_LEVEL_MAP: Record<number, LogLevel> = {
  0: 'debug',
  1: 'info',
  2: 'warn',
  3: 'error',
};

export function levelToSmallInt(level: unknown): number {
  if (typeof level !== 'string') return 1;
  return LEVEL_MAP[level.toLowerCase()] ?? 1;
}

export function smallIntToLevel(val: number): LogLevel {
  return REVERSE_LEVEL_MAP[val] || 'info';
}

export function isValidLogLevel(level: unknown): level is LogLevel {
  if (typeof level !== 'string') return false;
  return level.toLowerCase() in LEVEL_MAP;
}

export function normalizeLevel(level: string): LogLevel {
  const lower = level.toLowerCase();
  const num = LEVEL_MAP[lower];
  return REVERSE_LEVEL_MAP[num] ?? 'info';
}
