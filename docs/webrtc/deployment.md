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
3. Use the GitHub Actions setup below for deployment without local commands. The workflow overrides `WEB_ORIGIN`, `ALLOWED_ORIGINS` and the Worker name from the selected GitHub environment; the checked-in localhost settings remain for local development.

### GitHub Actions setup (no local deployment commands)

The **WebRTC migration checks** workflow builds the static frontend (`dist`), the legacy server frontend, and the Worker bundle; runs unit, restart, native compatibility and real-browser checks; and uploads a seven-day build artifact. Cloudflare deployment runs only after both check jobs pass. Pull requests never deploy or receive deployment credentials.

1. In GitHub repository **Settings → Environments**, create `cloudflare-staging`. Create `cloudflare-production` separately when ready for release. Use distinct Worker names and credentials for the two environments; each Worker owns its own Durable Object room namespace. Keep each name stable across redeployments. Restrict production to `main`; environment reviewers can provide the school's release gate.
2. Add these **environment secrets** to each environment you intend to deploy:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare deployment token, using the **Edit Cloudflare Workers** template scoped to the intended account |
| `CLOUDFLARE_ACCOUNT_ID` | The account ID from your Cloudflare dashboard |
| `CREATE_ROOM_SECRET` | A random staff access code of at least 32 characters |
| `TURN_KEY_ID` | Your managed TURN key ID |
| `TURN_API_TOKEN` | The TURN API token used to generate temporary client credentials |

The deployment token and TURN token serve different purposes. Do not paste their values into workflow files, repository variables, issue comments or chat. Cloudflare documents [GitHub Actions authentication](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) and [uploading runtime secrets alongside code](https://developers.cloudflare.com/workers/configuration/secrets/#upload-secrets-alongside-code). The helper uses the repository's locked Wrangler version and a private temporary secret file, removes it after success or failure, and does not put secret values into command arguments or build artifacts.

3. Add these **environment variables** (not secrets):

| Variable | Example |
|---|---|
| `CLOUDFLARE_WORKER_NAME` | `whitepad-signalling-staging` |
| `WEB_ORIGIN` | `https://whitepad-webrtc.vercel.app` |
| `ALLOWED_ORIGINS` | `https://whitepad-webrtc.vercel.app` |

Origins must be exact HTTPS origins without paths, trailing slashes or wildcards. A comma-separated allowlist must include `WEB_ORIGIN`. Use a stable test-project hostname or include the exact preview origin you are testing; arbitrary Vercel previews are not trusted automatically. The helper fails before deployment if required configuration is missing. Production deployments never enable `LOCAL_DIRECT_ONLY`.

4. Choose how to deploy:
   - **Automatic staging:** set repository **Settings → Secrets and variables → Actions → Variables → `CLOUDFLARE_AUTO_DEPLOY`** to `true`. Successful push runs on `codex/webrtc-classrooms` or `main` then deploy to `cloudflare-staging`. This is disabled until you set that variable. Push your next commit after configuration, or rerun the push workflow. Automatic deployment never targets production.
   - **Manual:** once this workflow exists on the repository's default branch, open **Actions → WebRTC migration checks → Run workflow**, select the branch and target environment, then run it. Choose staging first. Production is allowed only from `main`; selecting production from another branch skips the deployment job.

5. Find the deployed `workers.dev` URL in the deployment job output. Set Vercel's `VITE_SIGNALLING_URL` to that URL, with `VITE_TRANSPORT=webrtc` and `VITE_RTC_RELAY_ONLY=false`, then redeploy the frontend. Vercel's Git integration builds it automatically on subsequent pushes; do not add Vercel deployment credentials to the Cloudflare workflow.

The workflow does not purchase a plan, configure managed TURN keys, promote Vercel or replace the legacy deployment. Cloudflare must already permit Workers/Durable Objects/TURN for your account. A deployment changes the selected Worker and its runtime secrets; do not point staging variables at a production Worker. Deployments to the same GitHub environment are serialized rather than cancelling an in-flight migration. Secret rotation occurs on the next successful deployment.

### Optional local deployment

Local Wrangler remains available if needed. Set the intended HTTPS origins in `wrangler.toml`, authenticate with `npx wrangler login`, configure the three runtime secrets with `npx wrangler secret put <NAME>`, and run `npm run deploy`. GitHub Actions is the recommended path above; local login is not needed for CI.

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

The build remains static React/Vite; no Next.js or Vercel API route is needed. `npm run build` always writes to `dist`, regardless of transport selection. For the existing Kestrel/container deployment, use `npm run build:server` to explicitly write to `WhitePad.Server/wwwroot`; keep `VITE_TRANSPORT` unset for SignalR. The Dockerfile and legacy image workflow use that command.

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
