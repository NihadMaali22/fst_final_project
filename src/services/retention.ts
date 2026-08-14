import { config } from '../config.js';
import { writePool } from '../db/pool.js';
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

  // Rollups are plain tables, not partitions, so they need their own trim. Trim to the
  // start of the oldest surviving partition rather than to `cutoffTime`: partitions are
  // dropped a whole day at a time, so a raw day that straddles the cutoff is still
  // present, and trimming rollups by the raw cutoff would leave them undercounting it.
  try {
    const remaining = await listPartitions();
    let oldestStart: Date | null = null;
    for (const partition of remaining) {
      if (partition.startDate && (oldestStart === null || partition.startDate < oldestStart)) {
        oldestStart = partition.startDate;
      }
    }
    if (oldestStart) {
      const boundaryIso = oldestStart.toISOString();
      const client = await writePool.connect();
      try {
        await client.query('DELETE FROM log_rollup_1m WHERE bucket < $1', [boundaryIso]);
        await client.query('DELETE FROM log_rollup_1h WHERE bucket < $1', [boundaryIso]);
      } finally {
        client.release();
      }
    }
  } catch (err) {
    console.error('[Retention] Error trimming rollups:', err);
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
