# Deployment and rollback

Use a separate Vercel project and Cloudflare Worker for the migration. Keep the current ASP.NET deployment and native-compatible classroom links available until the new deployment passes the school acceptance matrix. No production deployment or paid subscription was created by this migration.

## Local development

Requires Node 22+, npm, and a browser supporting WebRTC data channels and IndexedDB.

```bash
cd src/WhitePad.Signalling
npm ci
cp .dev.vars.example .dev.vars
# Edit .dev.vars locally. Never commit it.
npm run dev
```

In a second terminal:

```bash
cd src/WhitePad.Web
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://localhost:5173/teacher`, create a room and enter the staff creation code from `.dev.vars`. Students open the generated link/QR in another browser profile. Camera/microphone permission is not required for data channels. To run direct-only local tests, set `LOCAL_DIRECT_ONLY=true` in `.dev.vars`; this bypass works only when `WEB_ORIGIN` has hostname `localhost`. Remove it to test TURN. Production has no silent direct-only fallback when credentials are missing.

Do not use an HTTP LAN IP to assess iPad recovery: IndexedDB and browser transport behavior must be checked on the real HTTPS deployment. Use the HTTPS migration preview for physical devices.

## Cloudflare signalling and TURN

1. Select the intended Cloudflare account. Create a TURN key in the Realtime TURN dashboard linked from [Cloudflare's credential guide](https://developers.cloudflare.com/realtime/turn/generate-credentials/). Record the key ID and the API token locally. The long-lived token belongs only on the signalling server.
2. Review whether Workers Paid and TURN billing must be enabled for that account. Do not enable a paid plan as an incidental test action. See [costs.md](costs.md).
3. In `wrangler.toml`, set `WEB_ORIGIN` to the migration frontend's HTTPS origin. Set `ALLOWED_ORIGINS` to a comma-separated list of exact, trusted frontend origins. Use separate preview and production Workers/storage namespaces; do not allow arbitrary preview domains.
4. Authenticate Wrangler to the selected account. Configure secrets interactively, so values do not enter shell history:

```bash
cd src/WhitePad.Signalling
npx wrangler secret put CREATE_ROOM_SECRET
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_API_TOKEN
npm run check
# After approving the account, environment and exact commit:
npm run deploy
```

Wrangler's `v1` migration creates the SQLite-backed `Classroom` Durable Object namespace. Subsequent code deployments must retain that binding, class name and migration history. Do not create an unrelated namespace for a routine release: that would orphan existing room credentials/control state. Objects survive Worker instance eviction and redeployments. Clients reconnect if a deployment closes their sockets.

The room creation code is a staff access mechanism. Use a long random value shared through the school's approved credential channel; it is not the teacher room token. Rotating it affects future room creation while existing rooms expire normally.

The TURN endpoint issues credentials valid for two hours, cached per authenticated member. Reconnection refreshes ICE configuration as needed. Long lessons and sleep/wake across expiry require device testing. An already issued TURN allocation is not instantly revoked by kicking a member; WhitePad membership is revoked immediately and TURN credentials expire separately.

Allow school clients outbound HTTPS/WSS to the Worker and WebRTC to the TURN hosts returned by the credential API. UDP is preferred; TCP/TLS relay options include port 443. Verify school firewall policies using a forced-relay test. DNS/IP allowlists are an operational responsibility; do not hardcode Cloudflare edge IPs.

## Vercel static frontend

Create a **new** Vercel project from this repository. Set Root Directory to `src/WhitePad.Web`, Framework to Vite, Build Command to `npm run build`, and Output Directory to `dist`. The checked-in `vercel.json` supplies SPA rewrites and basic response headers. Set these public build variables for the selected environment:

```text
VITE_TRANSPORT=webrtc
VITE_SIGNALLING_URL=https://<your-signalling-worker-host>
VITE_RTC_RELAY_ONLY=false
```

Do not put `CREATE_ROOM_SECRET`, `TURN_API_TOKEN`, a teacher token or any other secret in a `VITE_*` variable. Vite embeds those variables in public JavaScript. Changing build settings requires rebuilding the frontend. Select `VITE_RTC_RELAY_ONLY=true` on a dedicated test preview to force relay; normal production should use `false` to prefer direct connections.

The build remains static React/Vite; no Next.js or Vercel API route is needed. The legacy build, with `VITE_TRANSPORT` unset, still outputs to `WhitePad.Server/wwwroot` for the existing Kestrel/container deployment.

A Vercel preview may require deployment protection to be configured for participating test devices. Add its exact origin to the matching preview Worker's allowlist. Do not connect unreviewed previews to production room/control storage.

## Environment variables

| Name | Where | Secret? | Purpose |
|---|---|---|---|
| `VITE_TRANSPORT` | Frontend build | No | `webrtc`; unset preserves SignalR build |
| `VITE_SIGNALLING_URL` | Frontend build | No | HTTPS Worker origin; no trailing slash |
| `VITE_RTC_RELAY_ONLY` | Frontend build | No | Test override, `true` forces TURN |
| `ALLOWED_ORIGINS` | Worker configuration | No | Exact browser origins, comma separated |
| `WEB_ORIGIN` | Worker configuration | No | Origin for generated student join links |
| `CREATE_ROOM_SECRET` | Worker secret / ignored local `.dev.vars` | Yes | Staff room-creation access code |
| `TURN_KEY_ID` | Worker secret / ignored local `.dev.vars` | Server configuration | Cloudflare TURN key identifier |
| `TURN_API_TOKEN` | Worker secret / ignored local `.dev.vars` | Yes | Generate expiring TURN credentials |
| `LOCAL_DIRECT_ONLY` | Local Worker only | No | `true` allows local tests without TURN; localhost guard |

For test tooling only: `WEB_URL`, `SIGNALLING_URL`, `CREATE_ROOM_SECRET`, `TEST_TURN`, `ROOMS`, `PARTICIPANTS`, `SECONDS`, `DUTY`, `RELAY_ONLY`, and `REPORT`. The harness reads the creation secret from its environment; reports exclude credentials, SDP, candidates and drawing contents.

## Release and rollback

1. Run unit/type/build checks and local real-peer integration tests. Run the relay test with real credentials and the school network/device matrix. Review measured traffic and billing dashboards. Keep a draft PR until outstanding acceptance checks are complete.
2. Deploy the separate signalling service and a frontend preview from the reviewed commit. Record the account/project, namespace, frontend commit and preview URL. Exercise room creation, joining, question controls, refresh, clear during disconnect and forced relay before assigning a school-facing hostname.
3. Promote only with explicit release authorisation. Keep the legacy hostname and server running for the transition. The user must receive the updated iPad build or use Safari directly for WebRTC classrooms.
4. Roll back frontend deployment using Vercel's previous deployment. Roll back Worker code with its version history while retaining the same namespace and compatible stored schema. Do not delete migrations or storage as a rollback step.
5. If WebRTC service is unsuitable for a lesson, create a **new legacy room** on the old hostname. Rooms and board data are not migrated between transports. Existing migration rooms can finish or expire in 24 hours. Announce the new QR/link to the class through the teacher UI.

No rollback procedure here promises recovery after both devices have lost their local drawing data. This deployment stores room authority in the cloud, not durable copies of handwriting.
