import { RawLogEntry, ValidatedLogEntry, RejectionReason } from '../models/types.js';
export interface ValidationResult {
    validEntries: ValidatedLogEntry[];
    rejections: RejectionReason[];
}
export declare function validateLogBatch(logs: RawLogEntry[]): ValidationResult;
