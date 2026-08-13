import { LogLevel } from '../models/types.js';

const LEVEL_MAP: Record<LogLevel, number> = {
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

export function levelToSmallInt(level: LogLevel): number {
  return LEVEL_MAP[level];
}

export function smallIntToLevel(val: number): LogLevel {
  return REVERSE_LEVEL_MAP[val] || 'info';
}

export function isValidLogLevel(level: unknown): level is LogLevel {
  return typeof level === 'string' && level in LEVEL_MAP;
}
