import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from '../../src/utils/cursor.js';

describe('Cursor utilities', () => {
  it('should encode and decode cursor roundtrip', () => {
    const ts = '2026-07-20T14:32:01.123Z';
    const id = '12345';

    const cursor = encodeCursor(ts, id);
    expect(typeof cursor).toBe('string');
    expect(cursor.length).toBeGreaterThan(0);

    const decoded = decodeCursor(cursor);
    expect(decoded).not.toBeNull();
    expect(decoded?.ts).toBe(ts);
    expect(decoded?.id).toBe(id);
  });

  it('should return null for malformed cursor strings', () => {
    expect(decodeCursor('invalid-base64-string')).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it('should return null if cursor JSON lacks expected fields', () => {
    const invalidJson = Buffer.from(JSON.stringify({ wrong: 123 })).toString('base64url');
    expect(decodeCursor(invalidJson)).toBeNull();
  });
});
