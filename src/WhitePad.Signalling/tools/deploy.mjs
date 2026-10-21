// GitHub Actions deployment. Credentials never appear in command arguments or repository files.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const project = dirname(dirname(fileURLToPath(import.meta.url)));
const required = (env, name) => {
  if (typeof env[name] !== 'string' || !env[name].trim()) throw Error(`Configure ${name} in the GitHub environment`);
  return env[name];
};
const origin = value => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password || url.hostname.includes('*') || url.hostname === 'localhost' || url.hostname.endsWith('.localhost'))
    throw Error('Deployment origins must be exact HTTPS origins without paths, credentials or trailing slashes');
  return url.origin;
};
export function deploymentSettings(env) {
  const name = required(env, 'CLOUDFLARE_WORKER_NAME');
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(name)) throw Error('Invalid CLOUDFLARE_WORKER_NAME');
  const account = required(env, 'CLOUDFLARE_ACCOUNT_ID');
  if (!/^[a-fA-F0-9]{32}$/.test(account)) throw Error('Invalid CLOUDFLARE_ACCOUNT_ID');
  required(env, 'CLOUDFLARE_API_TOKEN');
  const web = origin(required(env, 'WEB_ORIGIN'));
  const allowed = required(env, 'ALLOWED_ORIGINS').split(',').map(value => origin(value.trim()));
  if (!allowed.includes(web)) throw Error('ALLOWED_ORIGINS must include WEB_ORIGIN');
  const secrets = Object.fromEntries(['CREATE_ROOM_SECRET', 'TURN_KEY_ID', 'TURN_API_TOKEN'].map(key => [key, required(env, key)]));
  if (secrets.CREATE_ROOM_SECRET.length < 32) throw Error('CREATE_ROOM_SECRET must have at least 32 characters');
  return { name, web, allowed: [...new Set(allowed)].join(','), secrets };
}
export function deploy(env = process.env, run = spawnSync) {
  const settings = deploymentSettings(env); // Fail before uploading anything if configuration is incomplete.
  const directory = mkdtempSync(join(tmpdir(), 'whitepad-deploy-'));
  try {
    const filename = join(directory, 'secrets.json');
    writeFileSync(filename, JSON.stringify(settings.secrets), { mode: 0o600 });
    const args = [join(project, 'node_modules/wrangler/bin/wrangler.js'), 'deploy',
      '--name', settings.name, '--var', `WEB_ORIGIN:${settings.web}`,
      '--var', `ALLOWED_ORIGINS:${settings.allowed}`, '--secrets-file', filename];
    const result = run(process.execPath, args, {
      cwd: project, stdio: 'inherit',
      env: { ...env, WRANGLER_SEND_METRICS: 'false', CI: 'true' },
    });
    if (result.error || result.status !== 0) throw Error('Cloudflare deployment failed; inspect the Wrangler step output');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { deploy(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
