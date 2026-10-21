# Verification and load testing

## Correctness results

Tested locally on macOS/arm64 using the installed Node toolchain, Cloudflare workerd emulator and headless Chromium. The checks exercise the real Worker and real RTCPeerConnections, rather than mocking the drawing transport.

| Check | Result |
|---|---|
| Frontend TypeScript + static Vite build | Passed |
| Existing drawing/teacher-state regressions plus protocol/renderer/API tests | 46 passed |
| Worker TypeScript | Passed |
| Creation quota policy | 3 passed; local/hosted isolation and UTC reset/retry checks |
| Deployment and hosted-smoke helpers | 6 passed; credentials/origins, Worker URL, temporary secret cleanup and authority/CORS/TURN response checks |
| Worker dry-run bundle | Passed without uploading |
| Worker restart and persistent authority | Passed locally |
| TypeScript backend checks | Worker typecheck, deploy/quota/restart and room/role isolation checks replace retired .NET tests |
| Real-browser integration | 11 direct/local tests passed; separate credential-enabled forced-TURN test passed |
| Swift Foundation join-link executable | Passed for web, legacy, custom scheme and encoded tokens |
| Full SwiftUI/iPad app / XCTest | Configured in iPad simulator CI; local machine has Command Line Tools without Xcode/iOS SDKs |
| Physical Safari/iPad/Pencil and school network | Not available locally |
| Hosted Worker and Vercel deployment | Main `8a4ab07` deployed; hosted creation/teacher authority/CORS/TURN credential checks passed in run 39670323257. Vercel public Worker URL corrected and rebuilt; hosted built-frontend room creation, student joining, teacher canvas drawing and both refresh recovery paths passed on 2026-10-21 |
| Authenticated TURN | Real Cloudflare credentials and forced relay with drawing passed locally; hosted Worker/school fallback and relay load pending |

Integration tests verify role/room isolation, no teacher/session access with a join token, origin rejection, authenticated sender binding, drawing, undo/redo, teacher refresh, student refresh/IndexedDB recovery, chunked snapshots, offline lock/clear/question reconciliation, live locks, kicking and delayed/duplicated delivery after a clear. The UI test draws into the real student canvas and checks real teacher canvas pixels, then verifies local ink survives refresh.

Protocol tests cover idempotency, gaps, epochs, malformed operations/snapshots, unknown objects, undo/redo materialisation, quantisation, operation capacity, rollback of unacknowledged offline changes, send-queue bounds and rate/backoff bounds. Incremental renderer tests ensure undo/replacement and changes below later objects trigger a full redraw. A slow RTC sender test keeps `bufferedAmount` above the high-water mark and confirms bounded queue/recovery behavior; this is not a physical congested-Wi-Fi test.

Legacy backend/frontend checks also passed in [GitHub CI](https://github.com/digiguru/WhitePad/actions/runs/39589410350) for commit `3e7f6f4`. The full [WebRTC migration workflow](https://github.com/digiguru/WhitePad/actions/runs/39589410188), including real Chromium peers and macOS Foundation compatibility, also passed for that commit. CI skips authenticated TURN without credentials; a separate local credential-enabled run passed.

## Authenticated relay result (2026-10-21)

`TEST_TURN=true ... --grep "forced relay establishes real peers"` passed with the locally configured staff code and real Cloudflare TURN credentials (one test, 26.9 seconds; 27.7 seconds including runner overhead). Both peers used relay-only policy, the selected student path was relayed, and the teacher received vector drawing operations. No credential values, raw SDP or candidate addresses were recorded.

The first run failed because ICE gathering did not complete before the 12-second deadline, despite five relay candidates being available. Other server transports remained in gathering. The fix sends already gathered candidates at the deadline; forced-relay mode still requires a relay candidate, and no-candidate attempts fail/retry. Four unit tests cover the deadline and completion behavior. This is a single-pair connectivity result, not a TURN capacity, latency or billing measurement. UDP-blocked school networks and provider egress counters remain untested.

## Commands

Start the local Worker and Vite frontend as described in [deployment.md](deployment.md). With the sample local test access code, the same direct-only setup used by CI is:

```bash
# Terminal 1
cd src/WhitePad.Signalling
npm ci
npx wrangler dev --port 8787 --var CREATE_ROOM_SECRET:local-test-only --var LOCAL_DIRECT_ONLY:true

# Terminal 2
cd src/WhitePad.Web
npm ci
VITE_TRANSPORT=webrtc VITE_SIGNALLING_URL=http://localhost:8787 npm run dev -- --host 127.0.0.1

# Terminal 3
cd src/WhitePad.Web
npm test
VITE_TRANSPORT=webrtc npm run build
cd ../WhitePad.Signalling
npm run check
npm run test:deploy
npm run test:quota
npm run build
npm run test:restart
npx playwright install chromium
npm run test:browser
```

For real TURN validation, configure `.dev.vars`, remove the local-direct override, restart the Worker, and run:

```bash
TEST_TURN=true npm run test:browser
```

That test forces relay policy on both ends and requires a selected relay candidate and delivered drawing operations. It does not pass using an empty ICE list or a mocked TURN response. Run it on school Wi-Fi with UDP blocked as well as the ordinary network, then compare provider egress counters.

## Built frontend hosted acceptance

After configuring the current staff secret in ignored `src/WhitePad.Signalling/.dev.vars` (or `CREATE_ROOM_SECRET` in the environment):

```bash
cd src/WhitePad.Signalling
npx playwright install chromium
WEB_URL=https://white-pad-woad.vercel.app node tools/hosted-browser.mjs
```

This opt-in test creates one ordinary room (consuming one daily creation allowance), creates two isolated Chromium contexts, uses the published UI to join/draw, checks teacher canvas pixels, and verifies both refresh paths. It uses the built frontend without Vite source imports. It closes browsers afterward; room metadata expires under normal retention. No traces, screenshots, tokens, SDP, candidate details or drawing contents are logged. This tests a hosted pair, not school-network fallback or capacity.

## Load harness

`src/WhitePad.Signalling/tools/load.mjs` creates real authenticated rooms, 15 React teacher dashboards and 385 student data-channel clients for 400 participants total. Students are grouped into one generation page per classroom; their teacher's actual React canvas grid renders every board. The generated student traffic uses six points/100ms, approximately 60 points/second while active, with one-second strokes. Intermittent traffic uses staggered active windows; sustained traffic uses 100% duty. This proves more than signalling-only load, but does not simulate 385 physical iPads, Pencil event handling or independent school Wi-Fi links.

```bash
cd src/WhitePad.Signalling
# Set CREATE_ROOM_SECRET in your environment without printing it.
ROOMS=15 PARTICIPANTS=400 SECONDS=120 DUTY=0.25 REPORT=/tmp/whitepad-intermittent.json npm run load
ROOMS=15 PARTICIPANTS=400 SECONDS=120 DUTY=1 REPORT=/tmp/whitepad-stress.json npm run load
# After configuring real TURN credentials and enabling relay in the teacher test build:
RELAY_ONLY=true ROOMS=15 PARTICIPANTS=400 SECONDS=120 DUTY=0.25 REPORT=/tmp/whitepad-relay.json npm run load
```

Set `VITE_RTC_RELAY_ONLY=true` when starting the teacher frontend for the relay-only run. `RELAY_ONLY=true` forces the generated student connections; verify the report actually contains selected relay candidates. Do not interpret a failed/missing selected pair as a direct connection.

`node tools/webrtc/summarise-load.mjs <report.json>` produces a compact result suitable for committing. Raw reports include bounded latency sample arrays and peer statistics, but exclude credentials, SDP, ICE candidates and drawing contents. Place private/local raw files under `docs/webrtc/raw/` (ignored). Export provider aggregate egress metrics separately.

The harness records selected direct/relay candidates, connection time, application bytes per active drawing minute, signalling bytes, post-batch delivery timestamps, teacher JS heap, task CPU seconds, frame counts/long tasks and peak buffered bytes. `getStats` exposes RTT too. Byte counts do not include all DTLS/SCTP/IP overhead and are not TURN billing counters. Wall-clock latency needs synchronized clocks if generation and teacher browsers run on different machines.

Use multiple load-generator hosts when this single machine becomes CPU or memory bound. One classroom per host can run with `ROOMS=1 PARTICIPANTS=29`; 15 such shards exercise 435 participants, or adjust ten shards to 27 participants and five to 26 for 400 total. Preserve the shared Worker deployment, collect all shard reports and inspect teacher CPU/rendering on the intended teacher device. Generation itself must not be the bottleneck.

## Recorded local runs

The committed `.summary.json` files contain exact measurements. An initial development-reload run is retained as invalid capacity evidence. The stable intermittent run used 15 teachers and 385 students for a 60-second drawing phase at 25% duty:

- 385/385 student peers connected at the end; 0 selected relay paths; 0 drawing errors.
- Approximately 24.9 MB application payload, 258,870 bytes per active drawing minute.
- Post-batch delivery median 4 ms, p95 43 ms. Add up to 100 ms initial batching and browser rendering/scheduling; these are local-host numbers.
- Student connection establishment median 24 ms, p95 322.5 ms.
- Teacher JS heap samples ranged about 9.4–40.1 MB. This excludes native WebRTC and GPU memory.
- Teacher task CPU ranged about 3.9–6.8 seconds per dashboard over its setup-plus-test window.
- 10 frames above 50 ms among 64,088 recorded teacher animation frames, one long task.

The final isolated intermittent run (`load-400-intermittent-isolated.summary.json`) also retained **385/385** student peers with no drawing errors: 26,688,585 application bytes, 277,284 bytes per active drawing minute, 5 ms median / 38 ms p95 post-batch delivery across 80,940 samples, and 2,834,739 signalling bytes including setup. It used the final tested code without edits or competing browser jobs during measurement.

Sustained 100% drawing remains an unresolved capacity gate. Earlier runs retained 70/385, 114/385 and 29/385 peers. The latest isolated sustained run (`load-400-stress-isolated.summary.json`) retained only **109/385**, with 13,130 ms median / 33,086 ms p95 delivery. Signalling sockets remained online; peer reconnecting was observed. No root cause or sustained 400-user capacity is claimed. The single-host generator and application bottlenecks need to be separated by distributed testing. Application bytes per active minute from failed runs must not be used as representative cost measurements.

The migration replaced whole-board redraw/pixel polling with incremental ink rendering, coalesced React board updates and changed IndexedDB persistence to an operation journal. A full single-classroom sustained run kept 28/28 students connected for 60 seconds, with 3 ms median / 14 ms p95 post-batch latency, about 242,921 bytes per active drawing minute and no drawing errors.

`load-400-development-reload` and `load-400-intermittent-final` were interrupted by development reloads and are invalid capacity evidence. Their summaries remain for transparency. All runs were short, local, direct-path tests; none certifies a school rollout or TURN capacity.

## Required release acceptance

Complete a full lesson-duration run, authenticated TURN/network fallback, real school network testing, delayed/lossy/mobile network transitions and physical Safari/iPad testing. Verify Worker redeploy/hibernation recovery against the hosted service, not just the emulator. Check all tools and eraser/background composition visually, teacher clear during an active gesture, lock/unlock while a device sleeps, kicking, new questions with pending answers, refresh while a stroke is in flight, IndexedDB eviction and the documented board limit. Use the minimum supported iPad and teacher hardware.

A draft PR may be reviewed before these checks, but do not promote the migration as capacity-certified or silently retire the legacy deployment.

## Native transport and source retirement (2026-10-21)

The native Swift/libwebrtc implementation compiled against the pinned 153.0.0 macOS framework. The binary checksum matched SwiftPM. JavaScriptCore shared-reducer checks passed for quantisation, undo/redo, clear/rollback, snapshot validation and indicators. One real native student delivered drawing to the hosted React teacher normally and with forced authenticated TURN; the latter required a selected native relay candidate. These single-pair checks are automated interoperability evidence, not a load test or physical iPad acceptance. The fixture injects in-memory persistence and does not prove iOS Keychain/Data Protection behavior. Full app and XCTest validation is configured on an iPad simulator in CI. No load test was resumed.

C#/SignalR source, backend tests, server-side static build, solution/Docker release and browser transport dependency are removed. Existing hosted services are not automatically stopped; older installed native apps require an update.
