-- Restores the attribute GIN index that 004 dropped, and records why this one is
-- affordable while the message trigram index is not.
--
-- 004 dropped both GIN indexes together on the grounds that GIN maintenance crushes
-- COPY throughput. Measured separately on this hardware (300k rows, 1-CPU Postgres):
--
--   no GIN index                    0.98s   ~306k rows/s
--   GIN (attributes jsonb_path_ops) 4.23s    ~71k rows/s   <- 4.7x above the 15k/s target
--   GIN (message gin_trgm_ops)     13.41s    ~22k rows/s   <- too close to the target
--
-- jsonb_path_ops emits ~one index entry per attribute key, so the write cost is bounded
-- by the attribute count. gin_trgm_ops emits one entry per trigram of the message —
-- roughly 45 per row here — which is what made the combined cost look prohibitive.
-- The trigram index is therefore built per-partition, off the hot path, by
-- services/index-manager.ts rather than being declared here.
--
-- Declaring this on the parent means every partition created later inherits it
-- automatically, so partition-manager.ts needs no changes.

CREATE INDEX IF NOT EXISTS idx_logs_attrs ON logs USING GIN (attributes jsonb_path_ops);
