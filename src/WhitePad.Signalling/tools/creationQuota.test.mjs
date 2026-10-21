import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creationQuota } from '../src/creationQuota.ts';
const now = Date.UTC(2026, 9, 21, 13), day = Math.floor(now / 86400000);
test('local development can create rooms after the hosted daily allowance is exhausted, but remains bounded', () => {
  assert.equal(creationQuota('http://localhost:8787/create', 'http://localhost:5173', now, { day, count: 100 }).allowed, true);
  assert.equal(creationQuota('http://127.0.0.1:8787/create', 'http://localhost:5173', now, { day, count: 999 }).allowed, true);
  assert.equal(creationQuota('http://localhost:8787/create', 'http://localhost:5173', now, { day, count: 1000 }).allowed, false);
});
test('hosted limits cannot be relaxed with a localhost origin or localhost-looking hostname', () => {
  for (const [request, web] of [
    ['https://signal.workers.dev/create', 'http://localhost:5173'],
    ['http://localhost:8787/create', 'https://whitepad.vercel.app'],
    ['https://localhost.attacker.test/create', 'http://localhost:5173'],
    ['https://signal.workers.dev/create', 'https://whitepad.vercel.app'],
  ]) {
    const quota = creationQuota(request, web, now, { day, count: 100 });
    assert.equal(quota.limit, 100);
    assert.equal(quota.allowed, false);
  }
});
test('daily reset and retry time remain deterministic across restarts', () => {
  const blocked = creationQuota('https://signal.workers.dev/create', 'https://whitepad.vercel.app', now, { day, count: 100 });
  assert.equal(blocked.retryAt, Date.UTC(2026, 9, 22));
  assert.equal(blocked.retryAfter, 11 * 3600);
  assert.deepEqual(creationQuota('https://signal.workers.dev/create', 'https://whitepad.vercel.app', blocked.retryAt, { day, count: 100 }).next, { day: day + 1, count: 1 });
});
