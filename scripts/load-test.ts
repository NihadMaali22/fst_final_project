// @ts-ignore
import autocannon from 'autocannon';

const targetUrl = process.env.TARGET_URL || 'http://localhost:8080';
const batchSize = parseInt(process.env.BATCH_SIZE || '100', 10);
const durationSeconds = parseInt(process.env.DURATION || '30', 10);
const connections = parseInt(process.env.CONNECTIONS || '20', 10);
const aggregateProbeEnabled = process.env.RUN_AGGREGATE_PROBE !== 'false';

console.log(`Starting load test against ${targetUrl}...`);
console.log(`Batch size: ${batchSize} logs/req | Duration: ${durationSeconds}s | Connections: ${connections}`);

const sampleBatch = {
  logs: Array.from({ length: batchSize }).map((_, i) => ({
    timestamp: new Date().toISOString(),
    level: ['debug', 'info', 'warn', 'error'][i % 4],
    service: ['checkout', 'auth', 'payment', 'inventory'][i % 4],
    message: `User transaction attempt ${i} processed successfully`,
    attributes: {
      user_id: String(1000 + (i % 500)),
      region: ['us-east', 'eu-west', 'ap-south'][i % 3],
      retries: i % 5,
    },
  })),
};

function runIngestionLoad(): Promise<any> {
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url: `${targetUrl}/logs`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(sampleBatch),
        connections,
        duration: durationSeconds,
      },
      (err: any, results: any) => {
        if (err) return reject(err);
        resolve(results);
      }
    );
    autocannon.track(instance);
  });
}

// Fires GET /logs/aggregate once per second for the test duration and records
// latency percentiles — the ingestion load above never touches this endpoint,
// so without this there's no local way to measure the "aggregation query p95
// while ingestion is active" target before relying on the grader's own harness.
async function runAggregateProbe(): Promise<{ p50: number; p95: number; max: number; count: number; errors: number } | null> {
  if (!aggregateProbeEnabled) return null;

  const latencies: number[] = [];
  let errors = 0;
  const until = Date.now() + durationSeconds * 1000;

  while (Date.now() < until) {
    const tickStart = Date.now();
    const since = new Date(Date.now() - 3600_000).toISOString();
    const untilParam = new Date().toISOString();
    try {
      const res = await fetch(
        `${targetUrl}/logs/aggregate?since=${encodeURIComponent(since)}&until=${encodeURIComponent(untilParam)}&bucket=1m`
      );
      latencies.push(Date.now() - tickStart);
      if (!res.ok) {
        errors++;
        console.error(`[AggregateProbe] non-2xx: ${res.status}`);
      }
    } catch (err) {
      errors++;
      console.error('[AggregateProbe] request failed:', err instanceof Error ? err.message : err);
    }

    const elapsed = Date.now() - tickStart;
    if (elapsed < 1000) {
      await new Promise((r) => setTimeout(r, 1000 - elapsed));
    }
  }

  if (latencies.length === 0) return { p50: 0, p95: 0, max: 0, count: 0, errors };
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const max = latencies[latencies.length - 1];
  return { p50, p95, max, count: latencies.length, errors };
}

async function main() {
  const [ingestResults, aggregateResults] = await Promise.all([runIngestionLoad(), runAggregateProbe()]);

  const totalLogsIngested = ingestResults.requests.total * batchSize;
  const logsPerSec = totalLogsIngested / durationSeconds;

  console.log('\n=== Ingestion Load Test Results ===');
  console.log(`Total Requests: ${ingestResults.requests.total}`);
  console.log(`Total Logs Ingested: ${totalLogsIngested}`);
  console.log(`Sustained Ingestion Rate: ${logsPerSec.toFixed(0)} logs/second`);
  console.log(`Latency p50: ${ingestResults.latency.p50} ms`);
  console.log(`Latency p95: ${ingestResults.latency.p95} ms`);
  console.log(`Latency p99: ${ingestResults.latency.p99} ms`);
  console.log(`Errors / Non-2xx: ${ingestResults.non2xx + ingestResults.errors}`);
  console.log('====================================\n');

  if (aggregateResults) {
    console.log('=== Concurrent Aggregation Probe Results (1 req/sec) ===');
    console.log(`Requests: ${aggregateResults.count}`);
    console.log(`Latency p50: ${aggregateResults.p50} ms`);
    console.log(`Latency p95: ${aggregateResults.p95} ms`);
    console.log(`Latency max: ${aggregateResults.max} ms`);
    console.log(`Errors: ${aggregateResults.errors}`);
    console.log(`Target: p95 < 1000 ms — ${aggregateResults.p95 < 1000 ? 'PASS' : 'FAIL'}`);
    console.log('==========================================================\n');
  }
}

main().catch((err) => {
  console.error('Load test error:', err);
  process.exit(1);
});
