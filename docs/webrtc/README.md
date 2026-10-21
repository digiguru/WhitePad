# WebRTC migration status and remaining work

Updated 2026-10-21. Work is on `codex/webrtc-classrooms`. The migration is opt-in; the existing SignalR deployment remains available. No hosted deployment or service purchase has been performed.

## Completed

- [x] Static React/Vite build, TypeScript signalling service using Cloudflare Durable Objects, persistent room/control authority and authenticated student-to-teacher WebRTC channels.
- [x] Separate teacher, join and student-session credentials; role/room checks, bounded signalling, short-lived TURN integration and configurable environment variables.
- [x] Versioned drawing protocol, local rendering, bounded backpressure, replay/snapshots, IndexedDB recovery and teacher-control reconciliation.
- [x] Existing classroom tools and controls retained, with incremental teacher rendering and operation-journal persistence.
- [x] Native iPad transitional routing to Safari for WebRTC rooms; legacy native rooms remain supported. This is not a native WebRTC implementation.
- [x] 34 frontend tests, both frontend build modes, Worker TypeScript and 11 real-browser integration tests passed locally. One authenticated TURN test is skipped pending credentials.
- [x] Local Worker restart/persistent-authority test and standalone Swift join-link checks passed.
- [x] Architecture, protocol, deployment, environment, rollback and cost-model documentation; real-peer/browser load harness and CI checks.

## Remaining implementation and review tasks

- [x] Final isolated 400-participant intermittent run: 385/385 student peers, no drawing errors, 5 ms median / 38 ms p95 post-batch delivery over 60 seconds at 25% duty.
- [x] Consolidated compact load summaries; raw reports remain local and ignored. Interrupted development runs are excluded from capacity evidence.
- [ ] Review the final diff, commit the feature branch and open a draft PR with validation, limitations and rollback instructions.
- [ ] Diagnose the sustained 400-participant failure and repeat on distributed load generators. The latest isolated sustained run retained only **109/385 student peers** after 60 seconds. This is an unresolved capacity gate; single-host resource saturation and application bottlenecks have not been separated.

## Release gates requiring credentials or external environments

- [ ] Configure `TURN_KEY_ID` and `TURN_API_TOKEN` in ignored `src/WhitePad.Signalling/.dev.vars`, then validate forced authenticated TURN, blocked-UDP fallback and provider traffic counters. Cloudflare dashboard: Realtime → TURN → create a key. Keep secrets out of Git and chat.
- [ ] Deploy an isolated Worker and Vercel preview after account/environment selection; verify hosted restart, redeploy, hibernation and reconnect behavior. Production promotion remains a separate decision.
- [ ] Run a full lesson-duration test at approximately 15 classrooms/400 participants on representative teacher hardware and school networks, including 10%, 25% and sustained drawing, direct and relay paths.
- [ ] Test physical Safari/iPad/Apple Pencil, sleep/background/network transitions, all tools, controls during gestures and IndexedDB eviction. Full Xcode/XCTest and native app build require an Xcode environment; only standalone Foundation compatibility checks ran here.
- [ ] Run legacy .NET checks in CI or an environment with the .NET SDK; it is unavailable locally.
- [ ] Replace traffic/billing assumptions with measured production-like signalling, TURN and Vercel usage. No fixed total cost is promised.

A successful earlier short intermittent run connected 385/385 students; a full single classroom sustained run connected 28/28. Neither establishes sustained 400-user capacity. Drawings have local recovery, not durable cloud backup; losing both student and teacher local data loses that board.

## Documentation

- [Architecture and security](architecture.md)
- [Drawing and recovery protocol](protocol.md)
- [Setup, environment variables, deployment and rollback](deployment.md)
- [Native iPad transition](ipad-transition.md)
- [Verification commands, measurements and acceptance](verification.md)
- [Cost model and assumptions](costs.md)
