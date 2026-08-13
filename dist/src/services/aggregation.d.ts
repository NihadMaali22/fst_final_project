import { AggregateParams, AggregateLogsResponse } from '../models/types.js';
export declare class AggregationValidationError extends Error {
    constructor(message: string);
}
export declare function executeAggregateLogs(params: AggregateParams): Promise<AggregateLogsResponse>;
