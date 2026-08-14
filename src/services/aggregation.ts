import { readPool } from '../db/pool.js';
import { AggregateParams, AggregateLogsResponse, AggregateBucketOutput } from '../models/types.js';
import { isValidIso8601, bucketToPostgresInterval } from '../utils/time.js';
import { isValidLogLevel, levelToSmallInt, smallIntToLevel } from '../utils/level.js';

export class AggregationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AggregationValidationError';
  }
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

  const whereClauses: string[] = [];
  const queryValues: unknown[] = [];
  let paramIndex = 1;

  // Interval and origin parameters for date_bin
  const pInterval = paramIndex++;
  queryValues.push(pgInterval);
  const pOrigin = paramIndex++;
  queryValues.push(sinceDate.toISOString());

  // Time range filter
  const pSince = paramIndex++;
  queryValues.push(sinceDate.toISOString());
  whereClauses.push(`timestamp >= $${pSince}`);

  const pUntil = paramIndex++;
  queryValues.push(untilDate.toISOString());
  whereClauses.push(`timestamp < $${pUntil}`);

  // 5. Filter: service
  if (params.service !== undefined) {
    if (typeof params.service !== 'string' || params.service.trim().length === 0) {
      throw new AggregationValidationError("service must be a non-empty string");
    }
    whereClauses.push(`service = $${paramIndex++}`);
    queryValues.push(params.service);
  }

  // 6. Filter: level (case-insensitive)
  if (params.level !== undefined) {
    const levelStr = String(params.level).toLowerCase();
    if (!isValidLogLevel(levelStr)) {
      throw new AggregationValidationError(`unsupported log level: '${params.level}'`);
    }
    whereClauses.push(`level = $${paramIndex++}`);
    queryValues.push(levelToSmallInt(levelStr));
  }

  // 7. Filter: q (partition-pruned seq scan, no GIN index)
  if (params.q !== undefined) {
    if (typeof params.q !== 'string') {
      throw new AggregationValidationError("invalid 'q' parameter");
    }
    whereClauses.push(`message ILIKE $${paramIndex++}`);
    queryValues.push(`%${params.q}%`);
  }

  // 8. Filter: attr.<key> — uses ->> text extraction (no GIN needed)
  for (const [key, value] of Object.entries(params)) {
    if (key.startsWith('attr.') && value !== undefined) {
      const attrKey = key.slice(5);
      if (attrKey.length === 0) {
        throw new AggregationValidationError("attribute key cannot be empty");
      }
      const pKey = paramIndex++;
      const pVal = paramIndex++;
      whereClauses.push(`attributes->>$${pKey} = $${pVal}`);
      queryValues.push(attrKey, String(value));
    }
  }

  const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

  let selectGroupSql = 'NULL AS grp';
  let groupBySql = 'GROUP BY 1';

  if (params.group_by === 'service') {
    selectGroupSql = 'service AS grp';
    groupBySql = 'GROUP BY 1, 2';
  } else if (params.group_by === 'level') {
    selectGroupSql = 'level AS grp';
    groupBySql = 'GROUP BY 1, 2';
  }

  // Deliberately no ORDER BY here: an ORDER BY matching the GROUP BY key makes
  // Postgres prefer a plan that sorts every matching row before grouping (GroupAggregate),
  // rather than the far cheaper HashAggregate (grouping a ~month-wide scan into a
  // couple dozen buckets). The result set is tiny (at most a few thousand buckets),
  // so it's sorted in JS below instead of forcing a full-table sort in Postgres.
  const sql = `
    SELECT
      date_bin($${pInterval}::interval, timestamp, $${pOrigin}::timestamptz) AS bucket_start,
      ${selectGroupSql},
      COUNT(*)::bigint AS count
    FROM logs
    ${whereSql}
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
