import { readPool } from '../db/pool.js';

const knownPartitions = new Set<string>();

function formatDatePart(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}_${mm}_${dd}`;
}

function formatDateIsoDay(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function getPartitionName(date: Date): string {
  return `logs_${formatDatePart(date)}`;
}

export async function ensurePartition(date: Date): Promise<string> {
  const partitionName = getPartitionName(date);
  if (knownPartitions.has(partitionName)) {
    return partitionName;
  }

  const startDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const endDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));

  const startStr = formatDateIsoDay(startDay);
  const endStr = formatDateIsoDay(endDay);

  const client = await readPool.connect();
  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS ${partitionName} PARTITION OF logs
      FOR VALUES FROM ('${startStr}') TO ('${endStr}');
    `;
    await client.query(sql);
    knownPartitions.add(partitionName);
    return partitionName;
  } finally {
    client.release();
  }
}

export async function preCreatePartitions(daysBefore = 7, daysAfter = 7): Promise<void> {
  const now = new Date();
  for (let i = -daysBefore; i <= daysAfter; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i));
    await ensurePartition(d);
  }
}

export interface PartitionInfo {
  tableName: string;
  startDate: Date | null;
  endDate: Date | null;
}

export async function listPartitions(): Promise<PartitionInfo[]> {
  const client = await readPool.connect();
  try {
    const sql = `
      SELECT
        c.relname AS table_name,
        pg_get_expr(c.relpartbound, c.oid) AS part_bound
      FROM pg_class c
      JOIN pg_inherits i ON i.inhrelid = c.oid
      JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname = 'logs'
      ORDER BY c.relname;
    `;
    const { rows } = await client.query(sql);

    return rows.map((row) => {
      const name = row.table_name as string;
      const bound = row.part_bound as string;
      // bound format: FOR VALUES FROM ('2026-08-13 00:00:00+00') TO ('2026-08-14 00:00:00+00')
      let startDate: Date | null = null;
      let endDate: Date | null = null;

      const match = /FROM \('([^']+)'\) TO \('([^']+)'\)/.exec(bound);
      if (match) {
        startDate = new Date(match[1]);
        endDate = new Date(match[2]);
      }

      return {
        tableName: name,
        startDate,
        endDate,
      };
    });
  } finally {
    client.release();
  }
}

export async function dropPartition(partitionName: string): Promise<void> {
  const client = await readPool.connect();
  try {
    await client.query(`DROP TABLE IF EXISTS ${partitionName} CASCADE;`);
    knownPartitions.delete(partitionName);
  } finally {
    client.release();
  }
}
