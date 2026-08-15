import { describe, it, expect } from 'vitest';
import { isValidLogLevel, levelToSmallInt, smallIntToLevel, normalizeLevel } from '../../src/utils/level.js';
import { validateLogBatch } from '../../src/validators/log-validator.js';

const CONTRACT_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

describe('log level contract', () => {
  it('accepts exactly the four contract levels', () => {
    for (const level of CONTRACT_LEVELS) {
      expect(isValidLogLevel(level)).toBe(true);
    }
  });

  it('accepts contract levels case-insensitively', () => {
    for (const level of ['DEBUG', 'Info', 'WARN', 'Error']) {
      expect(isValidLogLevel(level)).toBe(true);
    }
  });

  // Regression: these were mapped as aliases of warn/error, so they passed validation and
  // were stored under a different level than the caller sent, instead of being rejected.
  it('rejects off-contract levels that were previously aliased', () => {
    for (const level of ['warning', 'fatal']) {
      expect(isValidLogLevel(level)).toBe(false);
    }
  });

  it('rejects other unsupported levels and non-strings', () => {
    for (const level of ['critical', 'trace', 'notice', 'verbose', '', 'err']) {
      expect(isValidLogLevel(level)).toBe(false);
    }
    for (const level of [3, null, undefined, {}, []]) {
      expect(isValidLogLevel(level)).toBe(false);
    }
  });

  it('round-trips every contract level through its numeric encoding', () => {
    for (const level of CONTRACT_LEVELS) {
      expect(smallIntToLevel(levelToSmallInt(level))).toBe(level);
      expect(normalizeLevel(level)).toBe(level);
    }
  });

  it('encodes levels in ascending severity order', () => {
    const encoded = CONTRACT_LEVELS.map(levelToSmallInt);
    expect(encoded).toEqual([...encoded].sort((a, b) => a - b));
    expect(new Set(encoded).size).toBe(CONTRACT_LEVELS.length);
  });
});

describe('validateLogBatch level enforcement', () => {
  const entry = (level: unknown) => ({
    timestamp: '2026-07-20T14:32:01.123Z',
    level,
    service: 'checkout',
    message: 'payment declined',
  });

  it('rejects off-contract levels with the index and a reason', () => {
    const res = validateLogBatch([entry('info'), entry('warning'), entry('fatal')] as never);

    expect(res.validEntries).toHaveLength(1);
    expect(res.rejections.map((r) => r.index)).toEqual([1, 2]);
    for (const rejection of res.rejections) {
      expect(rejection.reason).toMatch(/level/i);
    }
  });

  it('keeps a valid entry alongside an invalid one in the same batch', () => {
    const res = validateLogBatch([entry('warning'), entry('error')] as never);

    expect(res.validEntries).toHaveLength(1);
    expect(res.validEntries[0].levelStr).toBe('error');
    expect(res.rejections).toHaveLength(1);
    expect(res.rejections[0].index).toBe(0);
  });
});
