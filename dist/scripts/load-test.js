// @ts-ignore
import autocannon from 'autocannon';
const targetUrl = process.env.TARGET_URL || 'http://localhost:8080';
const batchSize = parseInt(process.env.BATCH_SIZE || '100', 10);
const durationSeconds = parseInt(process.env.DURATION || '30', 10);
console.log(`Starting load test against ${targetUrl}...`);
console.log(`Batch size: ${batchSize} logs/req | Duration: ${durationSeconds}s`);
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
const instance = autocannon({
    url: `${targetUrl}/logs`,
    method: 'POST',
    headers: {
        'content-type': 'application/json',
    },
    body: JSON.stringify(sampleBatch),
    connections: 20,
    duration: durationSeconds,
}, (err, results) => {
    if (err) {
        console.error('Load test error:', err);
        process.exit(1);
    }
    const totalLogsIngested = results.requests.total * batchSize;
    const logsPerSec = totalLogsIngested / durationSeconds;
    console.log('\n=== Load Test Results ===');
    console.log(`Total Requests: ${results.requests.total}`);
    console.log(`Total Logs Ingested: ${totalLogsIngested}`);
    console.log(`Sustained Ingestion Rate: ${logsPerSec.toFixed(0)} logs/second`);
    console.log(`Latency p50: ${results.latency.p50} ms`);
    console.log(`Latency p95: ${results.latency.p95} ms`);
    console.log(`Latency p99: ${results.latency.p99} ms`);
    console.log(`Errors / Non-2xx: ${results.non2xx + results.errors}`);
    console.log('=========================\n');
});
autocannon.track(instance);
