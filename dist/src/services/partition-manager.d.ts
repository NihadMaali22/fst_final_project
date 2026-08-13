export declare function getPartitionName(date: Date): string;
export declare function ensurePartition(date: Date): Promise<string>;
export declare function preCreatePartitions(daysBefore?: number, daysAfter?: number): Promise<void>;
export interface PartitionInfo {
    tableName: string;
    startDate: Date | null;
    endDate: Date | null;
}
export declare function listPartitions(): Promise<PartitionInfo[]>;
export declare function dropPartition(partitionName: string): Promise<void>;
