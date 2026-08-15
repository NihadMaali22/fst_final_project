import { config } from '../config.js';
import { writePool } from '../db/pool.js';
import { getPartitionName } from './partition-manager.js';

/**
 * Builds the message trigram index one partition at a time, and only on partitions that
 * are no longer receiving writes.
 *
 * `q=` filters compile to `message ILIKE '%...%'`, which no B-tree can serve, so without
 * a trigram index an aggregation over the retention window reads every row in range and
 * runs the match per row. Measured here: 4.0s over 2.7M rows, versus 0.4s once the index
 * exists.
 *
 * The index cannot simply be declared on the parent table, because then every new
 * partition would be created with it and COPY would pay trigram maintenance on the hot
 * path — ~45 index entries per row, which measured at ~22k rows/s against ~306k rows/s
 * unindexed. That cost is why 004 dropped the index outright.
 *
 * Daily partitioning makes the compromise available: only today's partition takes
 * writes, so yesterday's and older are immutable and can be indexed without touching
 * ingestion at all. A query spanning the retention window then reads indexed history and
 * sequentially scans at most one day.
 *
 * CONCURRENTLY keeps reads on the partition available while the index builds. It cannot
 * run inside a transaction, so each statement is issued in autocommit.
 */

const INDEX_SUFFIX = '_message_trgm_idx';

interface PartitionIndexState {
  partition: string;
  hasValidIndex: boolean;
  indexExists: boolean;
  isEmpty: boolean;
}

async function listPartitionIndexState(): Promise<PartitionIndexState[]> {
  const client = await writePool.connect();
  try {
    const { rows } = await client.query(
      `SELECT c.relname AS partition,
              EXISTS (
                SELECT 1 FROM pg_index idx
                JOIN pg_class ic ON ic.oid = idx.indexrelid
                WHERE idx.indrelid = c.oid
                  AND ic.relname = c.relname || $1
                  AND idx.indisvalid
              ) AS has_valid_index,
              EXISTS (
                SELECT 1 FROM pg_class ic WHERE ic.relname = c.relname || $1
              ) AS index_exists,
              c.reltuples = 0 AS is_empty
       FROM pg_inherits inh
       JOIN pg_class c ON c.oid = inh.inhrelid
       WHERE inh.inhparent = 'logs'::regclass
       ORDER BY c.relname`,
      [INDEX_SUFFIX]
    );
    return rows.map((r) => ({
      partition: r.partition as string,
      hasValidIndex: r.has_valid_index as boolean,
      indexExists: r.index_exists as boolean,
      isEmpty: r.is_empty as boolean,
    }));
  } finally {
    client.release();
  }
}

/**
 * Indexes sealed partitions that are still missing a usable trigram index.
 * Returns the number of indexes built.
 */
export async function buildPendingMessageIndexes(): Promise<number> {
  if (!config.messageIndexEnabled) return 0;

  // Partition names sort lexicographically in date order (logs_YYYY_MM_DD), so anything
  // ordering before today's name is sealed. Comparing names rather than parsing dates
  // keeps this in step with however partition-manager chooses to name them.
  const hotPartition = getPartitionName(new Date());

  let states: PartitionIndexState[];
  try {
    states = await listPartitionIndexState();
  } catch (err) {
    console.error('[IndexManager] Could not read partition index state:', err);
    return 0;
  }

  const pending = states.filter(
    (s) => s.partition < hotPartition && !s.hasValidIndex && !s.isEmpty
  );
  if (pending.length === 0) return 0;

  let built = 0;
  for (const state of pending.slice(0, config.messageIndexMaxPerRun)) {
    const indexName = `${state.partition}${INDEX_SUFFIX}`;
    const client = await writePool.connect();
    try {
      // A CONCURRENTLY build that failed previously leaves an invalid index behind. It
      // satisfies IF NOT EXISTS but is never used by the planner, so clear it first.
      if (state.indexExists) {
        console.log(`[IndexManager] Dropping invalid index ${indexName} before rebuild`);
        await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${indexName}`);
      }

      const startedAt = Date.now();
      await client.query(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName}
         ON ${state.partition} USING GIN (message gin_trgm_ops)`
      );
      built++;
      console.log(
        `[IndexManager] Built ${indexName} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
      );
    } catch (err) {
      // A failure here costs query speed on one sealed partition, never correctness or
      // ingestion, so the next pass simply retries it.
      console.error(`[IndexManager] Failed to build ${indexName}:`, err instanceof Error ? err.message : err);
    } finally {
      client.release();
    }
  }

  return built;
}

let indexIntervalTimer: NodeJS.Timeout | null = null;

export function startIndexScheduler(intervalMs = config.messageIndexIntervalMs): void {
  if (!config.messageIndexEnabled) {
    console.log('[IndexManager] Message index building disabled');
    return;
  }

  // Deliberately not awaited: a cold start with a full retention window of unindexed
  // partitions would otherwise hold up the listen() call behind minutes of index builds.
  buildPendingMessageIndexes().catch((err) =>
    console.error('[IndexManager] Startup index build error:', err)
  );

  if (!indexIntervalTimer) {
    indexIntervalTimer = setInterval(() => {
      buildPendingMessageIndexes().catch((err) =>
        console.error('[IndexManager] Scheduled index build error:', err)
      );
    }, intervalMs);
    indexIntervalTimer.unref?.();
  }
}

export function stopIndexScheduler(): void {
  if (indexIntervalTimer) {
    clearInterval(indexIntervalTimer);
    indexIntervalTimer = null;
  }
}
