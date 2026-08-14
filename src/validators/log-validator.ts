import { RawLogEntry, ValidatedLogEntry, RejectionReason } from '../models/types.js';
import { isValidIso8601, isFutureTimestamp } from '../utils/time.js';
import { isValidLogLevel, levelToSmallInt, normalizeLevel } from '../utils/level.js';

export interface ValidationResult {
  validEntries: ValidatedLogEntry[];
  rejections: RejectionReason[];
}

export function validateLogBatch(logs: RawLogEntry[]): ValidationResult {
  const validEntries: ValidatedLogEntry[] = [];
  const rejections: RejectionReason[] = [];

  for (let i = 0; i < logs.length; i++) {
    const entry = logs[i];

    if (!entry || typeof entry !== 'object') {
      rejections.push({ index: i, reason: 'log entry must be an object' });
      continue;
    }

    // 1. Timestamp validation
    if (entry.timestamp === undefined || entry.timestamp === null) {
      rejections.push({ index: i, reason: 'missing required field: timestamp' });
      continue;
    }

    if (!isValidIso8601(entry.timestamp)) {
      rejections.push({ index: i, reason: `invalid timestamp format: '${entry.timestamp}'` });
      continue;
    }

    const tsDate = new Date(entry.timestamp as string);
    if (isFutureTimestamp(tsDate)) {
      rejections.push({ index: i, reason: 'timestamp is more than 5 minutes in the future' });
      continue;
    }

    // 2. Level validation (case-insensitive)
    if (entry.level === undefined || entry.level === null) {
      rejections.push({ index: i, reason: 'missing required field: level' });
      continue;
    }

    if (!isValidLogLevel(entry.level)) {
      rejections.push({ index: i, reason: `invalid level: '${entry.level}'` });
      continue;
    }

    const normalizedLevel = normalizeLevel(String(entry.level));

    // 3. Service validation
    if (entry.service === undefined || entry.service === null) {
      rejections.push({ index: i, reason: 'missing required field: service' });
      continue;
    }

    if (typeof entry.service !== 'string' || entry.service.trim().length === 0) {
      rejections.push({ index: i, reason: 'service must be a non-empty string' });
      continue;
    }

    // 4. Message validation
    if (entry.message === undefined || entry.message === null) {
      rejections.push({ index: i, reason: 'missing required field: message' });
      continue;
    }

    if (typeof entry.message !== 'string') {
      rejections.push({ index: i, reason: 'message must be a string' });
      continue;
    }

    // Allow empty message strings — only reject non-string types
    // Some specs allow empty messages; trim-check would be too restrictive

    // 5. Attributes validation
    let attributes: Record<string, string | number | boolean> = {};

    if (entry.attributes !== undefined && entry.attributes !== null) {
      if (typeof entry.attributes !== 'object' || Array.isArray(entry.attributes)) {
        rejections.push({ index: i, reason: 'attributes must be a flat object' });
        continue;
      }

      let invalidAttr = false;
      const attrObj = entry.attributes as Record<string, unknown>;

      for (const [key, val] of Object.entries(attrObj)) {
        const valType = typeof val;
        if (val === null || (valType !== 'string' && valType !== 'number' && valType !== 'boolean')) {
          rejections.push({
            index: i,
            reason: `attribute '${key}' contains invalid type '${val === null ? 'null' : valType}'. Only string, number, and boolean allowed`,
          });
          invalidAttr = true;
          break;
        }
      }

      if (invalidAttr) {
        continue;
      }

      attributes = attrObj as Record<string, string | number | boolean>;
    }

    validEntries.push({
      timestamp: tsDate,
      timestampIso: tsDate.toISOString(),
      level: levelToSmallInt(normalizedLevel),
      levelStr: normalizedLevel,
      service: entry.service,
      message: entry.message,
      attributes,
    });
  }

  return { validEntries, rejections };
}
