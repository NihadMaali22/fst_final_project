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

  it('GET /logs should return ingested logs', async () => {
    const res = await fetch(`${baseUrl}/logs?service=smoke-service`, {
      headers: getHeaders(),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.logs)).toBe(true);
    expect(body.logs.length).toBeGreaterThan(0);
    expect(body.logs[0].service).toBe('smoke-service');
  });

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
