import { pathToFileURL } from 'node:url';
// Checks the exact workers.dev endpoint reported by the deployment step. Never prints tokens or ICE data.
export async function hostedSmoke(env = process.env, fetcher = fetch) {
const endpoint = new URL(env.SIGNALLING_URL ?? '');
const name = env.CLOUDFLARE_WORKER_NAME;
if (endpoint.protocol !== 'https:' || !name || !endpoint.hostname.startsWith(name + '.') || !endpoint.hostname.endsWith('.workers.dev') || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash)
  throw Error('Expected the verified Worker deployment origin');
const origin = env.WEB_ORIGIN, code = env.CREATE_ROOM_SECRET;
if (!origin || !code) throw Error('Hosted smoke configuration is missing');
async function request(path, token, body = {}) {
  const response = await fetcher(endpoint.origin + path, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { Origin: origin, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw Error(`Hosted ${path === '/create' ? 'creation' : 'authority'} check failed (${response.status})`);
  if (response.headers.get('access-control-allow-origin') !== origin) throw Error('Hosted CORS configuration mismatch');
  return response.json();
}
const room = await request('/create', code, { name: 'Deployment smoke check' });
if (!room.roomId || !room.teacherToken || !room.joinToken) throw Error('Hosted room credentials missing');
const session = await request(`/rooms/${room.roomId}/session`, room.teacherToken);
if (!session.control) throw Error('Hosted teacher authority missing');
const turn = await request(`/rooms/${room.roomId}/turn`, room.teacherToken);
if (!Array.isArray(turn.iceServers) || !turn.iceServers.some(s => [s.urls].flat().some(url => typeof url === 'string' && /^turns?:/.test(url)))) throw Error('Hosted TURN credentials missing');
console.log('Hosted room creation, teacher authority, exact-origin CORS and real TURN credential issuance passed.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await hostedSmoke();
