import { readPool } from '../db/pool.js';
import { QueryParams, QueryLogsResponse, FormattedLogOutput } from '../models/types.js';
import { levelToSmallInt, smallIntToLevel, isValidLogLevel } from '../utils/level.js';
import { isValidIso8601 } from '../utils/time.js';
import { decodeCursor, encodeCursor } from '../utils/cursor.js';

export class QueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryValidationError';
  }
}

export async function executeQueryLogs(params: QueryParams): Promise<QueryLogsResponse> {
  const whereClauses: string[] = [];
  const queryValues: unknown[] = [];
  let paramIndex = 1;

  // 1. Limit validation
  let limit = 100;
  if (params.limit !== undefined) {
    const parsedLimit = Number(params.limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
      throw new QueryValidationError("limit must be an integer between 1 and 1000");
    }
    limit = parsedLimit;
  }

  // 2. Service filter
  if (params.service !== undefined) {
    if (typeof params.service !== 'string' || params.service.trim().length === 0) {
      throw new QueryValidationError("service must be a non-empty string");
    }
    whereClauses.push(`service = $${paramIndex++}`);
    queryValues.push(params.service);
  }

  // 3. Level filter (case-insensitive)
  if (params.level !== undefined) {
    const levelStr = String(params.level).toLowerCase();
    if (!isValidLogLevel(levelStr)) {
      throw new QueryValidationError(`unsupported log level: '${params.level}'`);
    }
    whereClauses.push(`level = $${paramIndex++}`);
    queryValues.push(levelToSmallInt(levelStr));
  }

  // 4. Time range filters (since & until)
  let sinceDate: Date | null = null;
  let untilDate: Date | null = null;

  if (params.since !== undefined) {
    if (!isValidIso8601(params.since)) {
      throw new QueryValidationError(`invalid timestamp for 'since': '${params.since}'`);
    }
    sinceDate = new Date(params.since);
    whereClauses.push(`timestamp >= $${paramIndex++}`);
    queryValues.push(sinceDate.toISOString());
  }

  if (params.until !== undefined) {
    if (!isValidIso8601(params.until)) {
      throw new QueryValidationError(`invalid timestamp for 'until': '${params.until}'`);
    }
    untilDate = new Date(params.until);
    whereClauses.push(`timestamp < $${paramIndex++}`);
    queryValues.push(untilDate.toISOString());
  }

  if (sinceDate && untilDate && untilDate.getTime() <= sinceDate.getTime()) {
    throw new QueryValidationError("'until' must be later than 'since'");
  }

  // 5. Message substring filter (q)
  if (params.q !== undefined) {
    if (typeof params.q !== 'string') {
      throw new QueryValidationError("invalid 'q' parameter");
    }
    whereClauses.push(`message ILIKE $${paramIndex++}`);
    queryValues.push(`%${params.q}%`);
  }

  // 6. Attribute filters (attr.<key>)
  for (const [key, value] of Object.entries(params)) {
    if (key.startsWith('attr.') && value !== undefined) {
      const attrKey = key.slice(5);
      if (attrKey.length === 0) {
        throw new QueryValidationError("attribute key cannot be empty");
      }
      // Try to parse value as number or boolean for JSON containment
      let typedValue: string | number | boolean = String(value);
      if (value === 'true') typedValue = true;
      else if (value === 'false') typedValue = false;
      else {
        const num = Number(value);
        if (!isNaN(num) && String(num) === String(value)) typedValue = num;
      }

      const jsonPattern = JSON.stringify({ [attrKey]: typedValue });
      const stringJsonPattern = JSON.stringify({ [attrKey]: String(value) });
      const p1 = paramIndex++;
      const p2 = paramIndex++;
      const p3 = paramIndex++;

      // Try containment with typed value, string value, and text extraction fallback
      whereClauses.push(
        `(attributes @> $${p1}::jsonb OR attributes @> $${p2}::jsonb OR attributes->>$${p3} = '${String(value).replace(/'/g, "''")}')`
      );
      queryValues.push(jsonPattern, stringJsonPattern, attrKey);
    }
  }

  // 7. Cursor pagination
  if (params.cursor !== undefined) {
    const payload = decodeCursor(params.cursor);
    if (!payload) {
      throw new QueryValidationError("invalid or malformed cursor");
    }
    const pTs = paramIndex++;
    const pId = paramIndex++;
    whereClauses.push(`(timestamp, id) < ($${pTs}::timestamptz, $${pId}::bigint)`);
    queryValues.push(payload.ts, payload.id);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const fetchLimit = limit + 1; // Fetch 1 extra to determine if next page exists
  const limitParamIndex = paramIndex++;
  queryValues.push(fetchLimit);

  const sql = `
    SELECT id, timestamp, level, service, message, attributes
    FROM logs
    ${whereSql}
    ORDER BY timestamp DESC, id DESC
    LIMIT $${limitParamIndex};
  `;

  const client = await readPool.connect();
  try {
    const { rows } = await client.query(sql, queryValues);

    const hasMore = rows.length > limit;
    const resultRows = hasMore ? rows.slice(0, limit) : rows;

    const formattedLogs: FormattedLogOutput[] = resultRows.map((row) => ({
      id: String(row.id),
      timestamp: new Date(row.timestamp).toISOString(),
      level: smallIntToLevel(Number(row.level)),
      service: row.service,
      message: row.message,
      attributes: row.attributes || {},
    }));

    let next_cursor: string | null = null;
    if (hasMore && resultRows.length > 0) {
      const lastRow = resultRows[resultRows.length - 1];
      const lastTs = new Date(lastRow.timestamp).toISOString();
      const lastId = String(lastRow.id);
      next_cursor = encodeCursor(lastTs, lastId);
    }

    return {
      logs: formattedLogs,
      next_cursor,
    };
  } finally {
    client.release();
  }
}
