import { describe, it, expect } from 'vitest';
import { validateLogBatch } from '../../src/validators/log-validator.js';

describe('validateLogBatch', () => {
  it('should accept valid log entry', () => {
    const batch = [
      {
        timestamp: '2026-07-20T14:32:01.123Z',
        level: 'error',
        service: 'checkout',
        message: 'payment declined',
        attributes: {
          user_id: '42',
          region: 'eu-west',
          retries: 3,
          active: true,
        },
      },
    ];

    const res = validateLogBatch(batch);
    expect(res.validEntries).toHaveLength(1);
    expect(res.rejections).toHaveLength(0);
    expect(res.validEntries[0].service).toBe('checkout');
    expect(res.validEntries[0].level).toBe(3);
  });

  it('should reject entry missing timestamp', () => {
    const batch = [
      {
        level: 'info',
        service: 'auth',
        message: 'login success',
      },
    ];

    const res = validateLogBatch(batch);
    expect(res.validEntries).toHaveLength(0);
    expect(res.rejections).toHaveLength(1);
    expect(res.rejections[0].index).toBe(0);
    expect(res.rejections[0].reason).toContain('timestamp');
  });

  it('should reject invalid timestamp format', () => {
    const batch = [
      {
        timestamp: 'not-a-timestamp',
        level: 'info',
        service: 'auth',
        message: 'test',
      },
    ];

    const res = validateLogBatch(batch);
    expect(res.validEntries).toHaveLength(0);
    expect(res.rejections[0].reason).toContain('invalid timestamp format');
  });

  it('should reject timestamp more than 5 minutes in future', () => {
    const futureDate = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const batch = [
      {
        timestamp: futureDate,
        level: 'info',
        service: 'auth',
        message: 'test',
      },
    ];

    const res = validateLogBatch(batch);
    expect(res.validEntries).toHaveLength(0);
    expect(res.rejections[0].reason).toContain('more than 5 minutes in the future');
  });

  it('should reject invalid log level', () => {
    const batch = [
      {
        timestamp: new Date().toISOString(),
        level: 'critical',
        service: 'auth',
        message: 'test',
      },
    ];

    const res = validateLogBatch(batch);
    expect(res.validEntries).toHaveLength(0);
    expect(res.rejections[0].reason).toContain("invalid level: 'critical'");
  });

  it('should reject empty service or message', () => {
    const batch = [
      {
        timestamp: new Date().toISOString(),
        level: 'info',
        service: '',
        message: 'test',
      },
    ];

    const res = validateLogBatch(batch);
    expect(res.validEntries).toHaveLength(0);
    expect(res.rejections[0].reason).toContain('service must be a non-empty string');
  });

  it('should reject nested objects or arrays in attributes', () => {
    const batch = [
      {
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'api',
        message: 'test',
        attributes: {
          nested: { key: 'val' },
        },
      },
    ];

    const res = validateLogBatch(batch as any);
    expect(res.validEntries).toHaveLength(0);
    expect(res.rejections[0].reason).toContain('invalid type');
  });

  it('should handle partial batch rejection correctly', () => {
    const batch = [
      {
        timestamp: '2026-07-20T14:32:01.123Z',
        level: 'info',
        service: 'api',
        message: 'valid 1',
      },
      {
        timestamp: '2026-07-20T14:32:01.123Z',
        level: 'invalid_level',
        service: 'api',
        message: 'invalid 2',
      },
      {
        timestamp: '2026-07-20T14:32:01.123Z',
        level: 'warn',
        service: 'api',
        message: 'valid 3',
      },
    ];

    const res = validateLogBatch(batch);
    expect(res.validEntries).toHaveLength(2);
    expect(res.rejections).toHaveLength(1);
    expect(res.rejections[0].index).toBe(1);
  });
});
