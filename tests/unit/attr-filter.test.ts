import { describe, it, expect } from 'vitest';
import { buildAttributeContainmentSql } from '../../src/utils/attr-filter.js';

/** Collects bound parameters the way the query builders do. */
function collector() {
  const values: unknown[] = [];
  const bind = (v: unknown) => {
    values.push(v);
    return `$${values.length}`;
  };
  return { values, bind };
}

describe('buildAttributeContainmentSql', () => {
  it('emits an indexable containment predicate for a plain string value', () => {
    const { values, bind } = collector();
    const sql = buildAttributeContainmentSql('region', 'eu-west', bind);

    expect(sql).toBe('attributes @> $1::jsonb');
    expect(values).toEqual([JSON.stringify({ region: 'eu-west' })]);
  });

  it('also matches numbers stored with their original JSON type', () => {
    const { values, bind } = collector();
    const sql = buildAttributeContainmentSql('retries', '3', bind);

    // Both the string "3" and the number 3 must match, because the contract compares
    // attributes as strings while JSONB containment is type-exact.
    expect(sql).toBe('(attributes @> $1::jsonb OR attributes @> $2::jsonb)');
    expect(values).toEqual([JSON.stringify({ retries: '3' }), JSON.stringify({ retries: 3 })]);
  });

  it('also matches booleans stored with their original JSON type', () => {
    const { values, bind } = collector();
    buildAttributeContainmentSql('active', 'true', bind);

    expect(values).toEqual([JSON.stringify({ active: 'true' }), JSON.stringify({ active: true })]);
  });

  it('omits the numeric variant when the value is not its canonical JSON rendering', () => {
    // ->> would have compared '3' against '3.0' and not matched, so containment must not
    // match a stored number 3 here either.
    const { values, bind } = collector();
    const sql = buildAttributeContainmentSql('retries', '3.0', bind);

    expect(sql).toBe('attributes @> $1::jsonb');
    expect(values).toEqual([JSON.stringify({ retries: '3.0' })]);
  });

  it('treats non-numeric and empty values as strings only', () => {
    for (const raw of ['abc', '', ' ', 'NaN', '1e', '0x10']) {
      const { values, bind } = collector();
      buildAttributeContainmentSql('k', raw, bind);
      expect(values).toEqual([JSON.stringify({ k: raw })]);
    }
  });

  it('binds attribute keys as data so they cannot inject SQL', () => {
    const { values, bind } = collector();
    const sql = buildAttributeContainmentSql("x'); DROP TABLE logs; --", 'v', bind);

    expect(sql).toBe('attributes @> $1::jsonb');
    expect(sql).not.toContain('DROP TABLE');
    expect(values[0]).toBe(JSON.stringify({ "x'); DROP TABLE logs; --": 'v' }));
  });

  it('keeps negative and fractional numbers that do round-trip', () => {
    const { values, bind } = collector();
    buildAttributeContainmentSql('delta', '-2.5', bind);

    expect(values).toEqual([JSON.stringify({ delta: '-2.5' }), JSON.stringify({ delta: -2.5 })]);
  });
});
