import { LogLevel } from '../models/types.js';

const LEVEL_MAP: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  warning: 2,
  error: 3,
  fatal: 3,
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
