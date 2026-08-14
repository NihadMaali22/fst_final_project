import { describe, it, expect } from 'vitest';

const baseUrl = process.env.TEST_URL || 'http://localhost:8080';
const apiKey = process.env.LOADGEN_API_KEY || '';
const authEnabled = process.env.AUTH_ENABLED === 'true';

function getHeaders(customHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...customHeaders,
  };
  if (authEnabled && apiKey) {
    headers['authorization'] = `Bearer ${apiKey}`;
  }
  return headers;
}

// Ingestion is eventually consistent (visible within the write-buffer flush cycle,
// well under the service's 20s freshness SLA) rather than instantaneous, so reads
// after a write must poll instead of asserting immediate visibility.
async function pollForLogs(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 10_000,
  intervalMs = 200
): Promise<{ res: Response; body: any }> {
  const deadline = Date.now() + timeoutMs;
  let lastRes: Response;
  let lastBody: any;
  do {
    lastRes = await fetch(url, { headers });
    lastBody = await lastRes.json();
    if (Array.isArray(lastBody.logs) && lastBody.logs.length > 0) {
      return { res: lastRes, body: lastBody };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  } while (Date.now() < deadline);
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ingested log to become visible. Last response: ${JSON.stringify(lastBody)}`
  );
}

describe('Smoke Contract Tests', () => {
  it('GET /health should return 200 OK without authentication', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('POST /logs should ingest valid batch', async () => {
    const res = await fetch(`${baseUrl}/logs`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        logs: [
          {
            timestamp: new Date().toISOString(),
            level: 'error',
            service: 'smoke-service',
            message: 'smoke test error message',
            attributes: {
              smoke_id: '123',
              success: true,
            },
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accepted).toBe(1);
  });

  it(
    'GET /logs should return ingested logs',
    async () => {
      const { res, body } = await pollForLogs(`${baseUrl}/logs?service=smoke-service`, getHeaders());

      expect(res.status).toBe(200);
      expect(Array.isArray(body.logs)).toBe(true);
      expect(body.logs.length).toBeGreaterThan(0);
      expect(body.logs[0].service).toBe('smoke-service');
    },
    15_000
  );

  it('GET /logs/aggregate should aggregate logs into buckets', async () => {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const until = new Date(Date.now() + 3600_000).toISOString();

    const res = await fetch(`${baseUrl}/logs/aggregate?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&bucket=1m&service=smoke-service`, {
      headers: getHeaders(),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.buckets)).toBe(true);
  });

  if (authEnabled) {
    it('Should reject request with 401 when authentication token is missing', async () => {
      const res = await fetch(`${baseUrl}/logs`);
      expect(res.status).toBe(401);
    });
  }
});
