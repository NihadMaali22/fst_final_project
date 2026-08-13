import { LogLevel } from '../models/types.js';
export declare function levelToSmallInt(level: LogLevel): number;
export declare function smallIntToLevel(val: number): LogLevel;
export declare function isValidLogLevel(level: unknown): level is LogLevel;
