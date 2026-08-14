CREATE TABLE IF NOT EXISTS logs (
    id          BIGINT GENERATED ALWAYS AS IDENTITY,
    timestamp   TIMESTAMPTZ NOT NULL,
    level       SMALLINT NOT NULL,
    service     TEXT NOT NULL,
    message     TEXT NOT NULL,
    attributes  JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (timestamp, id)
) PARTITION BY RANGE (timestamp);



CREATE INDEX IF NOT EXISTS idx_logs_service ON logs (service, timestamp DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_logs_level ON logs (level, timestamp DESC, id DESC);


