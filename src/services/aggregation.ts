import { readPool } from '../db/pool.js';
import { AggregateParams, AggregateLogsResponse, AggregateBucketOutput } from '../models/types.js';
import { isValidIso8601, bucketToPostgresInterval } from '../utils/time.js';
import { isValidLogLevel, levelToSmallInt, smallIntToLevel } from '../utils/level.js';
import { config } from '../config.js';

export class AggregationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AggregationValidationError';
  }
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

function floorToUnit(ms: number, unitMs: number): number {
  return ms - (((ms % unitMs) + unitMs) % unitMs);
}

function ceilToUnit(ms: number, unitMs: number): number {
  const floored = floorToUnit(ms, unitMs);
  return floored === ms ? ms : floored + unitMs;
}

export async function executeAggregateLogs(params: AggregateParams): Promise<AggregateLogsResponse> {
  // 1. Required parameters check
  if (!params.since) {
    throw new AggregationValidationError("missing required parameter 'since'");
  }
  if (!params.until) {
    throw new AggregationValidationError("missing required parameter 'until'");
  }
  if (!params.bucket) {
    throw new AggregationValidationError("missing required parameter 'bucket'");
  }

  // 2. Validate since & until
  if (!isValidIso8601(params.since)) {
    throw new AggregationValidationError(`invalid timestamp for 'since': '${params.since}'`);
  }
  if (!isValidIso8601(params.until)) {
    throw new AggregationValidationError(`invalid timestamp for 'until': '${params.until}'`);
  }

  const sinceDate = new Date(params.since);
  const untilDate = new Date(params.until);

  if (untilDate.getTime() <= sinceDate.getTime()) {
    throw new AggregationValidationError("'until' must be later than 'since'");
  }

  // 3. Validate bucket
  const validBuckets = ['1m', '5m', '1h', '1d'];
  if (!validBuckets.includes(params.bucket)) {
    throw new AggregationValidationError(`invalid bucket size: '${params.bucket}'. Supported: 1m, 5m, 1h, 1d`);
  }
  const pgInterval = bucketToPostgresInterval(params.bucket as '1m' | '5m' | '1h' | '1d');

  // 4. Validate group_by
  if (params.group_by !== undefined && params.group_by !== 'service' && params.group_by !== 'level') {
    throw new AggregationValidationError(`invalid group_by: '${params.group_by}'. Supported: service, level`);
  }

  const queryValues: unknown[] = [];
  const bind = (value: unknown): string => {
    queryValues.push(value);
    return `$${queryValues.length}`;
  };

  // Interval and origin parameters for date_bin. A grid origin (epoch) puts every bucket
  // boundary on a natural multiple of the interval, which is what the rollup tables are
  // keyed on — so aggregations read pre-aggregated counts instead of scanning raw rows.
  const gridAligned = config.aggregateAlignment === 'grid';
  const pInterval = bind(pgInterval);
  const pOrigin = bind(gridAligned ? new Date(0).toISOString() : sinceDate.toISOString());

  // Dimension filters — these exist on the rollups too, so they never force a raw read.
  const dimensionClauses: string[] = [];

  // 5. Filter: service
  if (params.service !== undefined) {
    if (typeof params.service !== 'string' || params.service.trim().length === 0) {
      throw new AggregationValidationError("service must be a non-empty string");
    }
    dimensionClauses.push(`service = ${bind(params.service)}`);
  }

  // 6. Filter: level (case-insensitive)
  if (params.level !== undefined) {
    const levelStr = String(params.level).toLowerCase();
    if (!isValidLogLevel(levelStr)) {
      throw new AggregationValidationError(`unsupported log level: '${params.level}'`);
    }
    dimensionClauses.push(`level = ${bind(levelToSmallInt(levelStr))}`);
  }

  // Message and attribute filters need the raw rows; rollups only store counts.
  const rawOnlyClauses: string[] = [];

  // 7. Filter: q (partition-pruned seq scan, no GIN index)
  if (params.q !== undefined) {
    if (typeof params.q !== 'string') {
      throw new AggregationValidationError("invalid 'q' parameter");
    }
    rawOnlyClauses.push(`message ILIKE ${bind(`%${params.q}%`)}`);
  }

  // 8. Filter: attr.<key> — uses ->> text extraction (no GIN needed)
  for (const [key, value] of Object.entries(params)) {
    if (key.startsWith('attr.') && value !== undefined) {
      const attrKey = key.slice(5);
      if (attrKey.length === 0) {
        throw new AggregationValidationError("attribute key cannot be empty");
      }
      rawOnlyClauses.push(`attributes->>${bind(attrKey)} = ${bind(String(value))}`);
    }
  }

  const rawSource = (fromMs: number, toMs: number): string => {
    const clauses = [
      `timestamp >= ${bind(new Date(fromMs).toISOString())}`,
      `timestamp < ${bind(new Date(toMs).toISOString())}`,
      ...rawOnlyClauses,
    ];
    return `SELECT timestamp AS ts, service, level, 1::bigint AS count FROM logs WHERE ${clauses.join(' AND ')}`;
  };

  // A rollup bucket can only be summed wholesale into an answer bucket when no requested
  // boundary (since + k * interval) falls strictly inside it — otherwise its rows belong to
  // two different answer buckets. Such "straddling" buckets are excluded here and re-read
  // at a finer resolution below.
  const cleanPredicate = (column: string, span: string): string =>
    `date_bin(${pInterval}::interval, ${column}, ${pOrigin}::timestamptz) = ` +
    `date_bin(${pInterval}::interval, ${column} + interval '${span}' - interval '1 microsecond', ${pOrigin}::timestamptz)`;

  const rollupSource = (table: string, span: string, fromMs: number, toMs: number, mayStraddle: boolean): string => {
    const clauses = [
      `bucket >= ${bind(new Date(fromMs).toISOString())}`,
      `bucket < ${bind(new Date(toMs).toISOString())}`,
    ];
    if (mayStraddle) clauses.push(cleanPredicate('bucket', span));
    return `SELECT bucket AS ts, service, level, count FROM ${table} WHERE ${clauses.join(' AND ')}`;
  };

  // Re-reads the buckets excluded above at the next resolution down: straddling hours are
  // refilled from per-minute rollups, straddling minutes from raw rows. Each straddling
  // bucket is a narrow index range and there is at most one per answer bucket, so this
  // stays cheap even when the newest bucket covers a heavy ingestion window.
  const straddlingSource = (
    outerSpan: string,
    inner: { table: string; span: string } | null,
    fromMs: number,
    toMs: number
  ): string => {
    const pFrom = bind(new Date(fromMs).toISOString());
    const pTo = bind(new Date(toMs).toISOString());
    const pUntilBound = bind(untilDate.toISOString());
    const straddling =
      `SELECT DISTINCT date_bin(interval '${outerSpan}', b, TIMESTAMPTZ 'epoch') AS rb ` +
      `FROM generate_series(${pOrigin}::timestamptz, ${pUntilBound}::timestamptz, ${pInterval}::interval) AS b ` +
      `WHERE b <> date_bin(interval '${outerSpan}', b, TIMESTAMPTZ 'epoch')`;
    const bounds = `d.rb >= ${pFrom} AND d.rb < ${pTo}`;
    if (inner === null) {
      // Only reached when no message/attribute filter is in play, so the join needs
      // nothing beyond the time range.
      return (
        `SELECT l.timestamp AS ts, l.service AS service, l.level AS level, 1::bigint AS count ` +
        `FROM (${straddling}) d JOIN logs l ` +
        `ON l.timestamp >= d.rb AND l.timestamp < d.rb + interval '${outerSpan}' WHERE ${bounds}`
      );
    }
    return (
      `SELECT r.bucket AS ts, r.service AS service, r.level AS level, r.count AS count ` +
      `FROM (${straddling}) d JOIN ${inner.table} r ` +
      `ON r.bucket >= d.rb AND r.bucket < d.rb + interval '${outerSpan}' ` +
      `WHERE ${bounds} AND ${cleanPredicate('r.bucket', inner.span)}`
    );
  };

  const sinceMs = sinceDate.getTime();
  const untilMs = untilDate.getTime();
  const canUseRollup = rawOnlyClauses.length === 0;

  // Coarsest-first: hour rollups carry most of a wide window, minute rollups patch the
  // hours that straddle an answer boundary, and only the straddling minutes hit raw rows.
  // Buckets below an hour skip the hour level; a 1m bucket on an unaligned window would
  // straddle every minute, so it reads raw rows outright.
  const useHourLevel = canUseRollup && (params.bucket === '1d' || params.bucket === '1h');
  const useMinuteLevel =
    canUseRollup && (gridAligned || useHourLevel || params.bucket === '5m' || sinceMs % MINUTE_MS === 0);

  // On the grid origin every supported bucket size is a whole multiple of the rollup
  // grain, so no rollup bucket can span two answer buckets and the straddle correction
  // is never needed. Only the sub-bucket remainders at each end come from raw rows.
  const hoursMayStraddle = !gridAligned && sinceMs % HOUR_MS !== 0;
  const minutesMayStraddle = !gridAligned && sinceMs % MINUTE_MS !== 0;

  const sources: string[] = [];
  if (!useMinuteLevel) {
    sources.push(rawSource(sinceMs, untilMs));
  } else {
    // Minute grid always applies; the hour grid sits inside it when enabled.
    const minuteStart = Math.min(ceilToUnit(sinceMs, MINUTE_MS), untilMs);
    const minuteEnd = Math.max(floorToUnit(untilMs, MINUTE_MS), minuteStart);

    let hourStart = minuteStart;
    let hourEnd = minuteStart;
    if (useHourLevel) {
      const h0 = Math.min(ceilToUnit(sinceMs, HOUR_MS), untilMs);
      const h1 = Math.max(floorToUnit(untilMs, HOUR_MS), h0);
      if (h1 > h0) {
        hourStart = h0;
        hourEnd = h1;
        sources.push(rollupSource('log_rollup_1h', '1 hour', hourStart, hourEnd, hoursMayStraddle));
        if (hoursMayStraddle) {
          sources.push(
            straddlingSource('1 hour', { table: 'log_rollup_1m', span: '1 minute' }, hourStart, hourEnd)
          );
        }
      }
    }

    // Minutes outside the hour grid (its leading and trailing partial hours).
    if (hourStart > minuteStart) {
      sources.push(rollupSource('log_rollup_1m', '1 minute', minuteStart, hourStart, minutesMayStraddle));
    }
    if (minuteEnd > hourEnd) {
      sources.push(rollupSource('log_rollup_1m', '1 minute', Math.max(hourEnd, minuteStart), minuteEnd, minutesMayStraddle));
    }

    // Sub-minute remainders at each end, plus any minute that straddles a boundary.
    if (minuteStart > sinceMs) sources.push(rawSource(sinceMs, minuteStart));
    if (untilMs > minuteEnd) sources.push(rawSource(minuteEnd, untilMs));
    if (minutesMayStraddle && minuteEnd > minuteStart) {
      sources.push(straddlingSource('1 minute', null, minuteStart, minuteEnd));
    }
  }

  let selectGroupSql = 'NULL AS grp';
  let groupBySql = 'GROUP BY 1';

  if (params.group_by === 'service') {
    selectGroupSql = 'service AS grp';
    groupBySql = 'GROUP BY 1, 2';
  } else if (params.group_by === 'level') {
    selectGroupSql = 'level AS grp';
    groupBySql = 'GROUP BY 1, 2';
  }

  const filterSql = dimensionClauses.length > 0 ? `WHERE ${dimensionClauses.join(' AND ')}` : '';

  // Deliberately no ORDER BY here: an ORDER BY matching the GROUP BY key makes
  // Postgres prefer a plan that sorts every matching row before grouping (GroupAggregate),
  // rather than the far cheaper HashAggregate. The result set is tiny (at most a few
  // thousand buckets), so it's sorted in JS below instead.
  const sql = `
    SELECT
      date_bin(${pInterval}::interval, ts, ${pOrigin}::timestamptz) AS bucket_start,
      ${selectGroupSql},
      SUM(count)::bigint AS count
    FROM (
      ${sources.join('\n      UNION ALL\n      ')}
    ) AS parts
    ${filterSql}
    ${groupBySql};
  `;

  const client = await readPool.connect();
  try {
    const { rows } = await client.query(sql, queryValues);

    const buckets: AggregateBucketOutput[] = rows.map((row) => {
      let groupVal: string | null = null;
      if (params.group_by === 'service') {
        groupVal = String(row.grp);
      } else if (params.group_by === 'level') {
        groupVal = smallIntToLevel(Number(row.grp));
      }

      return {
        start: new Date(row.bucket_start).toISOString(),
        group: groupVal,
        count: Number(row.count),
      };
    });

    buckets.sort((a, b) => {
      const tsCompare = a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
      if (tsCompare !== 0) return tsCompare;
      if (a.group === b.group) return 0;
      if (a.group === null) return -1;
      if (b.group === null) return 1;
      return a.group < b.group ? -1 : 1;
    });

    return { buckets };
  } finally {
    client.release();
  }
}
