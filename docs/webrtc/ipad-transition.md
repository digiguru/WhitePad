# Native iPad WebRTC

The Swift app now connects directly to the TypeScript signalling Worker and uses a reliable ordered `whitepad-v1` libwebrtc data channel to its teacher. It no longer uses SignalR or automatically sends WebRTC rooms to Safari. The native drawing UI, tools, shapes, erasing, backgrounds, undo/redo, confidence and answered/question controls remain native. Safari is still available as a separate web client.

## Dependency and configuration

The Xcode project pins [stasel/WebRTC 153.0.0](https://github.com/stasel/WebRTC/tree/153.0.0), a community distribution of Google's libwebrtc. The SwiftPM manifest pins the binary SHA-256 `3e3a8946f27510133e3feed04d05fa23505bbe366e977620503bfc7986c2b78f`. The archive contains arm64 devices, arm64/x86_64 simulators and macOS. This was inspected and the downloaded checksum verified. It is a third-party binary dependency: retain its WebRTC licence/notices in distributions and review updates deliberately. No camera, microphone or media tracks are used.

Configure these **public, non-secret** Info.plist values before building:

- `WhitePadWebOrigin`: the exact frontend origin that the app accepts in join links.
- `WhitePadSignallingURL`: the HTTPS Worker origin authorized for that frontend.

Checked-in defaults use `https://white-pad-woad.vercel.app` and `https://whitepad-signalling-staging.digiguru.workers.dev`. Unknown classroom hosts are rejected before sending a join token. Native requests use the configured web Origin. HTTP and redirects are rejected. There are no embedded staff codes, teacher tokens, TURN secrets or permanent ICE credentials. TURN credentials are fetched using the student's authenticated session and refreshed before renegotiation as they expire.

The project targets iPadOS 17+. Xcode resolves the exact package version; no manual framework copying is required. The data channel rejects unordered or partially reliable configurations. ICE gathering sends collected candidates after completion or a 12-second bound, and relay-only checks require a relay candidate.

## Shared board rules and recovery

`NativeBoard.swift` runs the bundled, locally generated `whitepad-protocol.js` with JavaScriptCore. This is the same TypeScript validator/reducer used by the web client, not remote JavaScript or a web drawing surface. Run `node tools/webrtc/build-native-protocol.mjs` after changing the TypeScript contract; CI rejects a stale generated resource.

The native transport supplies operation IDs, sequence numbers and control/question generations; batches points at about 100 ms and flushes on pen-up; bounds frames and RTC buffering; and recovers with replay or chunked snapshots. Snapshot/replay delivery is lazy from the canonical board rather than an unbounded send queue. Incoming teacher frames are limited to hello/ack with matching authority generations and a bounded receive rate and at most 64 pending main-actor data callbacks. Teachers cannot write arbitrary native board operations.

Student-session credentials are separate Keychain records, tied to the room/join link and device. Saved sessions are reused for reconnect/relaunch rather than adding duplicate students. Expired credentials are removed when accessed after 24 hours. Boards and one pre-clear rollback checkpoint are stored atomically in Application Support, excluded from cloud backup and protected until first unlock on iOS. Writes are coalesced at 100 ms. Board files have seven-day cleanup and a maximum of 32 retained rooms; the protocol caps a board at 4 MiB/20,000 operations. Save failures are visible. There is no durable server drawing backup.

On signalling loss the legitimate UI pauses drawing and reports reconnecting. Reconnect uses exponential backoff with jitter, obtains new signalling tickets, refreshes TURN when needed and reconciles authenticated controls **before** replay. Foreground/background transitions force a fresh authenticated connection; no unsupported background execution is promised. A teacher clear resets the control generation, and changed control revisions discard unacknowledged edits. Lock cancels active gestures; confidence/answered remain available when teacher-locked. Kick or expired/revoked membership stops normal reconnect. A local UI lock is not security against a modified client drawing privately.

## Automated checks

Foundation/JavaScriptCore checks (macOS command-line tools):

```bash
swiftc src/WhitePad.iPad/WhitePad.iPad/Services/NativeBoard.swift \
  src/WhitePad.iPad/WhitePad.iPad/Models/DrawingStroke.swift \
  src/WhitePad.iPad/WhitePad.iPad/Models/HubMessages.swift \
  src/WhitePad.iPad/WhitePad.iPad/Shared/WhitePadError.swift \
  src/WhitePad.iPad/tools/verify-native-board.swift -o /tmp/whitepad-native-board
/tmp/whitepad-native-board src/WhitePad.iPad/WhitePad.iPad/Resources/whitepad-protocol.js
```

`tools/native-peer.swift` is a single native-student fixture. Build it with the app's four Services files, DrawingStroke/HubMessages/JoinRoomResponse/RoomSettings, WhitePadError and the pinned framework. Then run from `src/WhitePad.Signalling` with private `.dev.vars` configured:

```bash
WEB_URL=https://white-pad-woad.vercel.app \
SIGNALLING_URL=https://whitepad-signalling-staging.digiguru.workers.dev \
NATIVE_PEER_BINARY=/path/to/native-peer node tools/native-browser.mjs
# Repeat with RELAY_ONLY=true to require a selected native relay candidate.
```

The fixture uses an in-memory persistence adapter to avoid touching a developer's Keychain; the app uses protected device persistence. Join credentials enter the subprocess on stdin, never command-line arguments. Native diagnostics are discarded and only safe phase results are logged. Each run creates one expiring room. These are interoperability checks, not load tests.

## Validation and rollout limits

On 2026-10-21 the native transport compiled against the pinned macOS framework. Shared reducer checks passed, and a real native Swift/libwebrtc student delivered drawing to the hosted browser teacher both normally and with a verified forced TURN relay path. Full SwiftUI/iOS builds and XCTest are configured in GitHub's iPad simulator job; local Command Line Tools do not include Xcode/iOS SDKs. Do not describe macOS transport tests as physical iPad/Pencil acceptance.

Ship an updated signed iPad app before expecting older installed apps to use this protocol. Old installed SignalR clients cannot connect to the Worker. Existing hosted legacy services are not shut down by this repository change, but no legacy source/build path remains. Rollback requires reverting the retirement commits and redeploying the old server/app together; drawings and room credentials are not migrated between architectures. Physical-device, sleep/eviction, school-firewall and sustained-load acceptance remain open and are not being run automatically without the user's authorization.
