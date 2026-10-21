import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostedSmoke } from './hosted-smoke.mjs';
const env = { SIGNALLING_URL: 'https://whitepad-staging.example.workers.dev', CLOUDFLARE_WORKER_NAME: 'whitepad-staging', WEB_ORIGIN: 'https://whitepad.example', CREATE_ROOM_SECRET: 'fake-secret' };
test('hosted check never sends credentials to an unverified deployment endpoint', async () => {
  for (const url of ['http://whitepad-staging.example.workers.dev', 'https://other.example.workers.dev', 'https://whitepad-staging.attacker.example', 'https://whitepad-staging.example.workers.dev/path'])
    await assert.rejects(hostedSmoke({ ...env, SIGNALLING_URL: url }, () => { throw Error('must not fetch'); }), /verified Worker/);
});
test('hosted check verifies room authority and authenticated TURN without following redirects', async () => {
  let calls = 0;
  await hostedSmoke(env, async (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Origin, env.WEB_ORIGIN);
    assert.equal(options.headers.Authorization, calls === 0 ? 'Bearer fake-secret' : 'Bearer fake-teacher');
    const bodies = [{ roomId: 'test-room', teacherToken: 'fake-teacher', joinToken: 'fake-join' }, { control: { members: [] } }, { iceServers: [{ urls: ['turn:relay.example:3478'] }] }];
    return Response.json(bodies[calls++], { headers: { 'Access-Control-Allow-Origin': env.WEB_ORIGIN } });
  });
  assert.equal(calls, 3);
});
test('hosted check fails a bad origin policy instead of reporting a deployment success', async () => {
  await assert.rejects(hostedSmoke(env, async () => Response.json({})), /CORS configuration mismatch/);
});
