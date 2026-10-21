# WebRTC migration status and remaining work

Updated 2026-10-21. PRs #1–#3 are merged. The Vercel web deployment uses WebRTC with the TypeScript Cloudflare Worker; this branch makes WebRTC unconditional and retires the C#/SignalR source and build path. Existing deployed legacy services are not automatically stopped. No service purchase was performed.

## Completed

- [x] Static React/Vite build, TypeScript signalling service using Cloudflare Durable Objects, persistent room/control authority and authenticated student-to-teacher WebRTC channels.
- [x] Separate teacher, join and student-session credentials; role/room checks, bounded signalling, short-lived TURN integration and configurable environment variables.
- [x] Versioned drawing protocol, local rendering, bounded backpressure, replay/snapshots, IndexedDB recovery and teacher-control reconciliation.
- [x] Existing classroom tools and controls retained, with incremental teacher rendering and operation-journal persistence.
- [x] Native Swift/libwebrtc transport implemented using the bundled shared protocol through JavaScriptCore, with Keychain credentials, protected local boards and replay/control reconciliation. Normal and selected forced-TURN native-to-browser drawing passed. Full iOS app/XCTest validation is delegated to simulator CI; physical devices remain unverified.
- [x] 46 frontend tests, static frontend build, Worker TypeScript and 11 real-browser integration tests passed locally. A separate authenticated forced-TURN browser test also passed using real Cloudflare relay credentials. CI skips that credential-dependent test.
- [x] Local Worker restart/persistent-authority test and standalone Swift join-link checks passed. The complete WebRTC workflow also passed in GitHub CI.
- [x] Architecture, protocol, deployment, environment, rollback and cost-model documentation; real-peer/browser load harness and CI checks.
- [x] Frontend build writes to `dist`; the .NET/Docker output and release workflow are removed. GitHub Actions builds artifacts, gates deployment on backend/web/native checks, and verifies the deployed Worker before Vercel production promotion; see [setup instructions](deployment.md#github-actions-setup-no-local-deployment-commands).

## Remaining implementation and review tasks

- [x] Final isolated 400-participant intermittent run: 385/385 student peers, no drawing errors, 5 ms median / 38 ms p95 post-batch delivery over 60 seconds at 25% duty.
- [x] Consolidated compact load summaries; raw reports remain local and ignored. Interrupted development runs are excluded from capacity evidence.
- [x] Reviewed and committed the feature branch; [merged PR #1](https://github.com/digiguru/WhitePad/pull/1) includes validation, limitations and rollback instructions.
- [ ] Diagnose the sustained 400-participant failure and repeat on distributed load generators. The latest isolated sustained run retained only **109/385 student peers** after 60 seconds. This is an unresolved capacity gate; single-host resource saturation and application bottlenecks have not been separated.

## Release gates requiring credentials or external environments

- [x] Real Cloudflare credential issuance and one teacher/student pair using forced authenticated TURN passed locally on 2026-10-21.
- [ ] Validate hosted TURN, blocked-UDP school-network fallback, relay load and provider traffic counters. Keep secrets out of Git and chat.
- [x] Deploy the staging Worker and Vercel web frontend. Main commit `8a4ab07` passed [all CI and hosted authority/TURN credential checks](https://github.com/digiguru/WhitePad/actions/runs/39670323257). The web frontend is https://white-pad-woad.vercel.app and the Worker is https://whitepad-signalling-staging.digiguru.workers.dev.
- [x] Correct Vercel public build variables to `VITE_TRANSPORT=webrtc`, `VITE_SIGNALLING_URL=https://whitepad-signalling-staging.digiguru.workers.dev`, `VITE_RTC_RELAY_ONLY=false`; rebuild and verify the served JavaScript contains the Worker URL.
- [x] Hosted built-frontend Chromium acceptance passed: room creation through the teacher UI, student join, real drawing on the teacher canvas, student refresh/local recovery and teacher refresh/board recovery. Repeat with `tools/hosted-browser.mjs`; this is one pair, not a capacity result.
- [ ] Verify hosted restart, redeploy, hibernation and reconnect behavior. The web domain currently targets the staging Worker; a separate production Worker remains optional configuration before wider rollout.
- [ ] Run a full lesson-duration test at approximately 15 classrooms/400 participants on representative teacher hardware and school networks, including 10%, 25% and sustained drawing, direct and relay paths.
- [ ] Test physical Safari/iPad/Apple Pencil, sleep/background/network transitions, all tools, controls during gestures and IndexedDB eviction. Full Xcode/XCTest and native app build require an Xcode environment; only standalone Foundation compatibility checks ran here.
- [x] Historical legacy CI passed before retirement. Current backend checks target the TypeScript Worker; no .NET SDK is required.
- [ ] Replace traffic/billing assumptions with measured production-like signalling, TURN and Vercel usage. No fixed total cost is promised.

A successful earlier short intermittent run connected 385/385 students; a full single classroom sustained run connected 28/28. Neither establishes sustained 400-user capacity. Drawings have local recovery, not durable cloud backup; losing both student and teacher local data loses that board.

## Documentation

- [Architecture and security](architecture.md)
- [Drawing and recovery protocol](protocol.md)
- [Setup, environment variables, deployment and rollback](deployment.md)
- [Native iPad transition](ipad-transition.md)
- [Verification commands, measurements and acceptance](verification.md)
- [Cost model and assumptions](costs.md)
