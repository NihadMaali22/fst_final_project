import { config } from '../config.js';
import { listPartitions, dropPartition } from './partition-manager.js';

export async function runRetentionCleanup(): Promise<number> {
  const retentionMs = config.retentionDays * 24 * 60 * 60 * 1000;
  const cutoffTime = Date.now() - retentionMs;
  let droppedCount = 0;

  try {
    const partitions = await listPartitions();
    for (const partition of partitions) {
      if (partition.endDate && partition.endDate.getTime() < cutoffTime) {
        console.log(`[Retention] Dropping expired partition ${partition.tableName} (endDate: ${partition.endDate.toISOString()})`);
        await dropPartition(partition.tableName);
        droppedCount++;
      }
    }
  } catch (err) {
    console.error('[Retention] Error during retention cleanup:', err);
  }

  return droppedCount;
}

let retentionIntervalTimer: NodeJS.Timeout | null = null;

export function startRetentionScheduler(intervalMs = 3600_000): void {
  // Run once at startup
  runRetentionCleanup().catch((err) => console.error('[Retention] Startup cleanup error:', err));

  // Schedule recurring hourly cleanup
  if (!retentionIntervalTimer) {
    retentionIntervalTimer = setInterval(() => {
      runRetentionCleanup().catch((err) => console.error('[Retention] Scheduled cleanup error:', err));
    }, intervalMs);
  }
}

export function stopRetentionScheduler(): void {
  if (retentionIntervalTimer) {
    clearInterval(retentionIntervalTimer);
    retentionIntervalTimer = null;
  }
}
