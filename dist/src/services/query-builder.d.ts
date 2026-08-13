import { QueryParams, QueryLogsResponse } from '../models/types.js';
export declare class QueryValidationError extends Error {
    constructor(message: string);
}
export declare function executeQueryLogs(params: QueryParams): Promise<QueryLogsResponse>;
