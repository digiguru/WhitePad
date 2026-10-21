import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { deploy, deploymentSettings } from './deploy.mjs';
const fixture = () => ({
  CLOUDFLARE_WORKER_NAME: 'whitepad-signalling-staging',
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'fake-deployment-token',
  WEB_ORIGIN: 'https://whitepad-test.vercel.app', ALLOWED_ORIGINS: 'https://whitepad-test.vercel.app',
  CREATE_ROOM_SECRET: 'fake-staff-secret-'.repeat(3), TURN_KEY_ID: 'fake-key', TURN_API_TOKEN: 'fake-turn-token',
});
test('deployment rejects incomplete credentials and invalid or mismatched origins before invoking Wrangler', () => {
  for (const key of Object.keys(fixture())) {
    const env = fixture(); delete env[key];
    assert.throws(() => deploymentSettings(env));
  }
  for (const value of ['http://localhost:5173', 'https://site.test/path', 'https://site.test/', 'https://*.vercel.app', 'https://user:secret@site.test', 'https://localhost'])
    assert.throws(() => deploymentSettings({ ...fixture(), WEB_ORIGIN: value }));
  assert.throws(() => deploymentSettings({ ...fixture(), WEB_ORIGIN: 'https://*.vercel.app', ALLOWED_ORIGINS: 'https://*.vercel.app' }));
  assert.throws(() => deploymentSettings({ ...fixture(), ALLOWED_ORIGINS: 'https://other.test' }));
  assert.throws(() => deploymentSettings({ ...fixture(), CLOUDFLARE_WORKER_NAME: '--other-worker' }));
});
test('deployment uploads secrets with code, keeps them out of arguments, and cleans the private file on success or failure', () => {
  for (const status of [0, 1]) {
    let filename;
    const invoke = () => deploy(fixture(), (_command, args, options) => {
      filename = args[args.indexOf('--secrets-file') + 1];
      assert.deepEqual(JSON.parse(readFileSync(filename, 'utf8')), deploymentSettings(fixture()).secrets);
      assert.equal(statSync(filename).mode & 0o777, 0o600);
      for (const secret of Object.values(deploymentSettings(fixture()).secrets)) assert.ok(!args.join(' ').includes(secret));
      assert.ok(args.includes('whitepad-signalling-staging'));
      assert.equal(options.env.CI, 'true');
      return { status };
    });
    if (status) assert.throws(invoke, /deployment failed/); else invoke();
    assert.equal(existsSync(filename), false);
  }
});
