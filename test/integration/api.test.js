import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { rateLimitStore } from '../../server/middlewares/rateLimiter.js';

// Setup environment variables before importing the server to listen on a random free port (0)
process.env.PORT = '0';

// Dynamically import server to ensure process.env.PORT is respected
const { server } = await import('../../server.js');

describe('REST API Integration Tests', () => {
  let baseUrl;

  before(async () => {
    // Wait for the server to be listening
    await new Promise((resolve) => {
      if (server.listening) {
        resolve();
      } else {
        server.once('listening', resolve);
      }
    });

    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(() => {
    // Close the server to allow the test run to exit cleanly
    server.close();
  });

  test('GET /api/state/snapshot should return correct JSON schema and status code 200', async () => {
    const res = await fetch(`${baseUrl}/api/state/snapshot`);
    assert.strictEqual(res.status, 200);

    const contentType = res.headers.get('content-type');
    assert.ok(contentType && contentType.includes('application/json'));

    const data = await res.json();
    
    // Validate top-level schema contract
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.status, 'success');
    assert.strictEqual(data.source, 'server');
    assert.ok(typeof data.seq === 'number' || data.seq === null || data.seq === undefined);
    assert.ok(typeof data.timestamp === 'number' || typeof data.timestamp === 'string');
    assert.ok(data.state && typeof data.state === 'object');
  });

  test('Rate Limiter should return status 429 when client exceeds the requests threshold', async () => {
    const testIp = '12.34.56.78';
    const rateLimitKey = `api-global:${testIp}`;

    // Force the rate limit count to exceed the maximum threshold (limit is 200)
    rateLimitStore.set(rateLimitKey, {
      count: 201,
      resetTime: Date.now() + 15000
    });

    try {
      // Send a request masquerading as the target IP
      const res = await fetch(`${baseUrl}/api/state/snapshot`, {
        headers: {
          'x-forwarded-for': testIp
        }
      });

      assert.strictEqual(res.status, 429);

      const contentType = res.headers.get('content-type');
      assert.ok(contentType && contentType.includes('application/json'));

      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.code, 'TOO_MANY_REQUESTS');
      assert.strictEqual(data.type, 'rate_limit_exceeded');
      assert.strictEqual(data.retryable, true);
      assert.ok(data.details && typeof data.details.cooldownMs === 'number');
    } finally {
      // Cleanup the rate limiter state for the test IP
      rateLimitStore.delete(rateLimitKey);
    }
  });
});
