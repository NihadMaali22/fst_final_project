import { LogLevel } from '../models/types.js';
export declare function levelToSmallInt(level: unknown): number;
export declare function smallIntToLevel(val: number): LogLevel;
export declare function isValidLogLevel(level: unknown): level is LogLevel;
export declare function normalizeLevel(level: string): LogLevel;
