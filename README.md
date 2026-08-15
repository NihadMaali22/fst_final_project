# Log Ingestion and Query Service

A high-performance, structured log ingestion, querying, and aggregation service built with **Node.js, TypeScript, Fastify, and PostgreSQL 16**, containerized via Docker Compose. Inspired by systems like Datadog and Grafana Loki.

Designed to sustain **15,000+ logs/second** ingestion with sub-second time-bucketed aggregation queries under strict container resource constraints (0.5 CPU / 256 MB RAM for Application, 1 CPU / 1 GB RAM for PostgreSQL).

---

## Quick Start

### Prerequisites
- Docker & Docker Compose installed.

### 1. Launch the System
```bash
docker compose up -d
```
No environment files, arguments, or manual setup required. The system automatically initializes the database schema, pre-creates partitions, and reports healthy via `GET /health`.

### 2. Verify Health
```bash
curl http://localhost:8080/health
```
Response:
```json
{"status":"ok","database":"connected"}
```

---

## API Documentation

### 1. GET `/health`
Health check endpoint. Unauthenticated.
- **200 OK**: Database connected, migrations applied, ready for traffic.
- **530 Service Unavailable**: Database or startup issue.

---

### 2. POST `/logs` — Ingest Logs
Accepts single or batched structured log entries.

#### Request Body
```json
{
  "logs": [
    {
      "timestamp": "2026-07-20T14:32:01.123Z",
      "level": "error",
      "service": "checkout",
      "message": "payment declined",
      "attributes": {
        "user_id": "42",
        "region": "eu-west",
        "retries": 3
      }
    }
  ]
}
```

#### Validation Rules
- `timestamp` (Required): ISO 8601 string, max 5 minutes in future.
- `level` (Required): `debug` | `info` | `warn` | `error`.
- `service` (Required): Non-empty string.
- `message` (Required): Non-empty string.
- `attributes` (Optional): Flat key-value object (strings, numbers, booleans only).

#### Response
- **200 OK**: At least one entry accepted.
```json
{
  "accepted": 9,
  "rejected": [
    {
      "index": 3,
      "reason": "invalid level: 'critical'"
    }
  ]
}
```
- **400 Bad Request**: All entries rejected, malformed JSON, or invalid body structure.

---

### 3. GET `/logs` — Query Logs
Filter and paginate stored logs. Results sorted by `timestamp DESC, id DESC`.

#### Query Parameters
| Parameter | Description | Example |
|---|---|---|
| `service` | Exact service match | `service=checkout` |
| `level` | Exact level match | `level=error` |
| `since` | Inclusive start ISO timestamp | `since=2026-07-20T14:00:00Z` |
| `until` | Exclusive end ISO timestamp | `until=2026-07-20T15:00:00Z` |
| `attr.<key>` | Attribute string comparison | `attr.user_id=42` |
| `q` | Case-insensitive message substring search | `q=declined` |
| `limit` | Max results (default 100, max 1000) | `limit=500` |
| `cursor` | Opaque base64 pagination cursor | `cursor=eyJ0cyI6...` |

#### Response
```json
{
  "logs": [
    {
      "id": "12345",
      "timestamp": "2026-07-20T14:32:01.123Z",
      "level": "error",
      "service": "checkout",
      "message": "payment declined",
      "attributes": {
        "user_id": "42"
      }
    }
  ],
  "next_cursor": "eyJ0cyI6..."
}
```

---

### 4. GET `/logs/aggregate` — Aggregate Logs
Time-bucketed log volume aggregation.

#### Query Parameters
| Parameter | Required | Description | Example |
|---|---|---|---|
| `since` | **Yes** | Inclusive start ISO timestamp | `since=2026-07-20T14:00:00Z` |
| `until` | **Yes** | Exclusive end ISO timestamp | `until=2026-07-20T15:00:00Z` |
| `bucket` | **Yes** | Bucket size: `1m`, `5m`, `1h`, `1d` | `bucket=1m` |
| `group_by` | No | Dimension grouping: `service` or `level` | `group_by=service` |
| Filters | No | `service`, `level`, `attr.<key>`, `q` | `level=error` |

#### Response
```json
{
  "buckets": [
    {
      "start": "2026-07-20T14:00:00Z",
      "group": "checkout",
      "count": 118
    },
    {
      "start": "2026-07-20T14:00:00Z",
      "group": "auth",
      "count": 42
    }
  ]
}
```

---

## Schema and Index Design

### Table Schema (`logs`)
```sql
CREATE TABLE logs (
    id          BIGINT GENERATED ALWAYS AS IDENTITY,
    timestamp   TIMESTAMPTZ NOT NULL,
    level       SMALLINT NOT NULL,     -- 0=debug, 1=info, 2=warn, 3=error
    service     TEXT NOT NULL,
    message     TEXT NOT NULL,
    attributes  JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (timestamp, id)
) PARTITION BY RANGE (timestamp);
```

### Partitioning Strategy
- **Daily Range Partitions**: Log tables are partitioned by day (`logs_YYYY_MM_DD`).
- **Partition Management**: Partitions are automatically created on-demand during ingestion and pre-created 7 days in advance.
- **Retention**: Partition dropping (`DROP TABLE logs_YYYY_MM_DD CASCADE`) eliminates expired data in $O(1)$ time with zero table bloat or VACUUM overhead.

### Indexes

Indexes live on the partitions, not the parent, so index maintenance is scoped to the one
partition currently taking writes. Every partition carries the first three; the fourth is
added later, and deliberately never exists on the partition being written to.

| Index | Definition | Serves |
|---|---|---|
| Primary key | `(timestamp, id)` | Time-range pruning, `ORDER BY timestamp DESC, id DESC`, cursor pagination |
| `idx_logs_service` | `(service, timestamp DESC, id DESC)` | `service=` filters |
| `idx_logs_attrs` | `GIN (attributes jsonb_path_ops)` | `attr.<key>=` containment |
| `<partition>_message_trgm_idx` | `GIN (message gin_trgm_ops)` | `q=` substring search — **sealed partitions only** |

**Why `level` has no index.** Only four distinct values across the table, so a level filter
is not selective enough for an index scan to beat the partition scan it would replace.

**Why the trigram index is built late.** GIN maintenance is paid per index entry on insert,
and the two GIN candidates are not remotely equal in cost. Measured on this hardware,
inserting 300k rows into an otherwise identical table:

| Indexes present | Time | Effective rate |
|---|---|---|
| none | 0.98 s | ~306k rows/s |
| `GIN (attributes jsonb_path_ops)` | 4.23 s | ~71k rows/s |
| `GIN (message gin_trgm_ops)` | 13.41 s | ~22k rows/s |

`jsonb_path_ops` emits roughly one entry per attribute key (three here), so it retains ~4.7×
headroom over the 15k logs/s target and is declared on the parent table — every new
partition inherits it automatically. `gin_trgm_ops` emits one entry per trigram of the
message (~45 per row), which lands too close to the target to carry on the ingest path.

Daily partitioning resolves this: only today's partition takes writes, so
`services/index-manager.ts` builds the trigram index `CONCURRENTLY` on partitions that are
already sealed, a couple per pass. A query spanning the retention window therefore reads
indexed history and sequentially scans at most one day. This is what an earlier revision
got wrong — it dropped both GIN indexes together to protect ingest throughput, which made
`q=` aggregations scan the full window (4.0 s over 2.7M rows) and cost far more than the
write path ever gained.

---

## Ingestion Architecture (Write Buffer + COPY Protocol)

1. **Validate, then enqueue.** `POST /logs` validates each entry and pushes the accepted
   ones into an in-memory buffer. Nothing on the request path awaits the database.
2. **`COPY FROM STDIN`** (`pg-copy-streams`). Background flushes stream batches in Postgres'
   native text format, bypassing per-row SQL parse and plan overhead.
3. **Bounded batches, bounded concurrency.** Up to `WRITE_CONCURRENCY` (default 2) flushes
   run at once, each capped at `WRITE_FLUSH_SIZE` rows, so no single COPY holds the
   database for seconds during a spike.
4. **Rollups in the same transaction.** Each flush also applies its `(bucket, service, level)`
   counts to `log_rollup_1m` / `log_rollup_1h`, so a failed flush leaves neither the rows
   nor the counts behind and can be retried without double-counting.
5. **Backpressure, not unbounded buffering.** When the buffer exceeds `MAX_BUFFER_SIZE` or
   `MAX_BUFFER_BYTES`, `POST /logs` sheds with `429` rather than growing the heap into GC
   pauses on a 256 MB container.

**Durability posture.** Ingestion is acknowledged on successful validation and enqueue, not
on COMMIT — the contract requires data to be queryable within 20 s, not synchronously
durable, and this is what decouples ingest latency (p50 45 ms at 15k logs/s) from flush
latency. Failed flushes are retried up to 3 times with backoff, re-queued ahead of newer
arrivals. The cost is explicit and worth stating plainly: a process kill between
acknowledgement and flush loses whatever is still buffered. `flushAll()` drains on
SIGTERM/SIGINT, so this is a hard-kill window, not a restart window.

---

## Attribute Storage Strategy

Attributes are stored as **JSONB with original types preserved** (strings, numbers, booleans).
The validator rejects nested objects, arrays, and nulls, so every stored value is one of
those three scalar types.

The contract compares attributes **as strings** (`attr.retries=3` must match a stored number
`3`), while JSONB containment is type-exact. Filters therefore expand to one containment
branch per candidate type:

```sql
attributes @> '{"retries":"3"}'  OR  attributes @> '{"retries":3}'
```

Each branch is independently indexable and Postgres combines them with a `BitmapOr`. The
numeric branch is emitted only when the value is its own canonical JSON rendering — `'3'`
round-trips to `3`, `'3.0'` does not — which keeps the result identical to the text
comparison it replaces.

The obvious formulation, `attributes->>'key' = 'value'`, is what this replaced. It is
correct but has no GIN operator class, so it detoasts and probes the JSONB of **every** row
in the time range. Switching to containment is what lets `idx_logs_attrs` do the filtering.
See `src/utils/attr-filter.ts`.

---

## Retention Strategy

- **Configurable Retention**: Controlled via `RETENTION_DAYS` (default `30`).
- **Automated Hourly Scheduler**: Background interval worker checks partition end-dates against `NOW() - RETENTION_DAYS`.
- **Instant Drop**: Calls `DROP TABLE partition_name CASCADE`. Avoids `DELETE` locks, WAL bloat, and `VACUUM` overhead.

---

## Optional Features & Configuration

### Authentication & Multi-Tenancy
- **Master Switch**: `AUTH_ENABLED` (default `false`).
- **Seeded Key**: `LOADGEN_API_KEY` seeded at startup with full permissions.
- **Zero Configuration Default**: When `AUTH_ENABLED=false`, all endpoints accept unauthenticated requests and ignore unrecognized `Authorization` headers.
- **Bearer Token**: `Authorization: Bearer <key>` or `X-API-Key: <key>`.

| Environment Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Server HTTP port |
| `HOST` | `0.0.0.0` | Bind host address |
| `DATABASE_URL` | `postgres://logs_user:logs_password@db:5432/logs_db` | PostgreSQL connection string |
| `RETENTION_DAYS` | `30` | Data retention policy in days |
| `AUTH_ENABLED` | `false` | Master switch for API key auth |
| `LOADGEN_API_KEY` | `""` | Seeded load generator key |
| `WRITE_FLUSH_INTERVAL_MS` | `250` | Maximum write buffer latency before flush |
| `WRITE_FLUSH_SIZE` | `6000` | Max batch size per COPY stream flush |
| `WRITE_CONCURRENCY` | `2` | Concurrent COPY flushes |
| `READ_POOL_SIZE` / `WRITE_POOL_SIZE` | `5` / `4` | Connection pool sizes |
| `MAX_BUFFER_SIZE` | `60000` | Buffered entries before `POST /logs` sheds with 429 |
| `MAX_BUFFER_BYTES` | `104857600` | Buffered bytes before shedding |
| `AGGREGATE_ALIGNMENT` | `grid` | Bucket phasing: `grid` (epoch-aligned) or `since` (phased from `since`) |
| `MESSAGE_INDEX_ENABLED` | `true` | Build trigram indexes on sealed partitions |
| `MESSAGE_INDEX_INTERVAL_MS` | `900000` | How often to look for partitions needing an index |
| `MESSAGE_INDEX_MAX_PER_RUN` | `2` | Index builds per pass, to bound CPU on a 1-CPU database |

### A note on `AGGREGATE_ALIGNMENT`

The contract fixes `since`, `until` and `bucket`, but does not say where bucket boundaries
fall when `since` is not itself on a bucket boundary. Both modes return **exact** counts —
verified against raw-row ground truth across 288 window/bucket/filter/group combinations —
and differ only in phasing:

- `grid` (default): boundaries land on natural multiples (`00:00`, `01:00`, …), matching
  Grafana/Loki/Datadog, and lining up with the rollup grid so no straddle correction is needed.
- `since`: boundaries are phased from `since`. Exact, but a bucket that straddles the rollup
  grid must be re-read at a finer resolution, which costs roughly 2× on unaligned windows
  (measured: 16 ms → 490 ms median on a 22-day `1h` aggregation).

---

## Measured Performance Results

### Test environment

| | |
|---|---|
| Host | Linux, 8 vCPU, 6.9 GB RAM |
| Containers | Per contract — app 0.5 CPU / 256 MB, Postgres 1 CPU / 1 GB |
| Dataset at query benchmark | ~2.7M rows over 25 days (2.7× the ~1M target) |
| Dataset after load runs | ~5.0M rows |
| Batch size | 100 logs/request |
| Aggregation probe | 1 request/second, concurrent with ingestion |
| Tooling | `scripts/load-test.ts` (autocannon + concurrent probe) |

### Ingestion

| Offered rate | Accepted | Shed (429) | Ingest p50 | Ingest p99 | Agg p95 | Target |
|---|---|---|---|---|---|---|
| 15,000 logs/s | **15,000 logs/s** | 0 | 45 ms | 206 ms | **457 ms** | PASS |
| 20,000 logs/s | **18,269 logs/s** | 627 | — | 293 ms | **695 ms** | PASS |
| 30,000 logs/s | 10,200 logs/s | 7,606 | 80 ms | 848 ms | 2,006 ms | FAIL |

The sustained ceiling is **~18,000 logs/s**. Beyond it the application container — not
Postgres — saturates, and the write buffer sheds rather than growing the heap.

### Query latency (warmed, n=9, 22-day window over 2.7M rows)

| Query | median | p95 |
|---|---|---|
| `bucket=1d`, no filter | 7 ms | 9 ms |
| `bucket=1d`, `group_by=service` | 9 ms | 10 ms |
| `bucket=1h`, `group_by=level` | 34 ms | 99 ms |
| `bucket=1d`, `level=error` | 4 ms | 5 ms |
| `bucket=1h`, unaligned `since` | 16 ms | 21 ms |
| `bucket=1m` over 1 day | 39 ms | 87 ms |
| `bucket=1d`, `q=declined` | 540 ms | 577 ms |
| `bucket=1d`, `attr.region=eu-west` | 480 ms | 532 ms |
| `bucket=1d`, `attr.retries=3` | 238 ms | 342 ms |
| `GET /logs?attr.region=…&limit=100` | 6 ms | 7 ms |

### Resource usage

| Load | App CPU (limit 50%) | App RSS | Postgres CPU (limit 100%) | Postgres RSS |
|---|---|---|---|---|
| 15,000 logs/s | 33–39% | 37–41 MB | 22–62% | 310–573 MB |
| 30,000 logs/s | **50% (saturated)** | ~40 MB | 16–88% | ~570 MB |

### Bottlenecks discovered

1. **Filtered aggregations, not ingestion, were saturating Postgres.** Postgres sat at
   77–105% CPU while accepting only ~3,900 logs/s and the application idled below 9%.
   `q=` and `attr.` filters bypassed the rollups and scanned the full window — 1.79M rows
   with a per-row `ILIKE` — which both consumed the CPU that COPY needed and blocked the
   load generator's aggregation probe, capping the offered ingest rate.
2. **After that was fixed, the ceiling moved to application CPU.** At 30,000 logs/s the
   Node container pins its full 0.5 CPU on JSON parsing, validation and COPY-row
   formatting while Postgres still has headroom. This is now the binding constraint.

### Optimizations applied

| Change | Effect |
|---|---|
| Attribute filters rewritten to JSONB containment (`src/utils/attr-filter.ts`) | Makes `idx_logs_attrs` usable; stops detoasting every row in range |
| `idx_logs_attrs` restored on the parent table (migration `006`) | Attribute aggregations index-backed; ~4.7× headroom over target on writes |
| Trigram index built per-partition on sealed partitions (`services/index-manager.ts`) | `q=` aggregations 4.0 s → 0.54 s, with no cost on the ingest path |
| Partition-pruning predicates added to the straddle join (`services/aggregation.ts`) | Stops the unaligned-window correction probing every partition |
| Level aliases `warning`/`fatal` removed (`src/utils/level.ts`) | Off-contract levels now rejected on all three endpoints instead of silently remapped |

---

## Known Limitations

1. **Single-node PostgreSQL.** Scaling is vertical. Sharding would help writes, but writes
   are not the constraint — application CPU is — so it would add scatter-gather complexity
   to reads for no throughput gain at this size.
2. **Application CPU is the ingest ceiling (~18k logs/s).** Getting past it means cutting
   per-log work in Node (a faster JSON parser, or moving COPY-row formatting off the event
   loop), not adding database capacity.
3. **Acknowledged-then-buffered ingestion.** `POST /logs` returns before COMMIT, so a hard
   kill loses whatever is still buffered. Graceful shutdown drains; `SIGKILL` does not.
4. **`q=` on the current day is unindexed by design.** The trigram index is only built once
   a partition stops taking writes, so a substring search whose term is *rare in today's
   data* walks the day backwards row by row. Measured on a deliberately skewed dataset
   (99% of 2.37M same-day rows sharing one message): a term matching 99% of them returns in
   71 ms, one matching 0.2% takes 3.5 s. Evenly distributed real traffic does not show this,
   and it disappears once the partition seals. Indexing the hot partition instead would cap
   ingestion at ~22k rows/s.
5. **Short trigram queries.** Substring queries under 3 characters cannot use `pg_trgm` and
   fall back to scanning.
6. **Bucket phasing is a judgment call.** See `AGGREGATE_ALIGNMENT` above — the contract
   does not specify it.
