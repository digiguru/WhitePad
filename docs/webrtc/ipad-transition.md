# iPad compatibility and transition

The existing Swift app uses a hand-written SignalR/WebSocket transport in `Services/WhiteboardHubClient.swift`, with SwiftUI/PencilKit input and Foundation DTOs. It cannot speak the new SDP/data-channel protocol without a native WebRTC library. Sending its existing SignalR frames to the Worker would fail.

This migration implements an explicit transition rather than silently switching that transport:

- Legacy links keep using the native SignalR client and existing ASP.NET server.
- New QR/join links include `transport=webrtc`.
- `JoinLink.usesWebRTC` detects that marker, and `ParsedJoinLinkView` offers **Continue in Safari** instead of invoking the native hub client.
- `AppRouter.join` also rejects attempts to join a WebRTC link through the native transport.
- The browser destination is `/web-join`, with only room ID, student join token and transport marker. It uses the same React drawing tools and protocol as other web students.
- Remove `/web-join` from the domain's Universal Links association. Associate only `/join` (and any explicitly supported native paths). Otherwise iPadOS can reopen the app in a loop.

Existing installed app builds do not contain this detector. During rollout, keep the legacy hostname for those builds and distribute the updated app before using its universal-link entry point for WebRTC. For Safari-only classrooms, publish a `/web-join?...&transport=webrtc` link/QR that is excluded from Universal Links.

No native WebRTC dependency is added in this transition. A future fully native implementation needs a reviewed libwebrtc iOS distribution supporting reliable ordered data channels, DTLS/SCTP, ICE/TURN over the required transports, and lifecycle recovery on the school's minimum iPadOS version. It must implement the versioned protocol, bounded queues, durable-control reconciliation, sequence/generation checks, point encoding and local persistence. Keep teacher and student-session credentials separate in native secure storage. Do not reuse the join token as a teacher/session credential.

## Automated native validation

Foundation-only join-link checks can run with a Swift command-line toolchain:

```bash
swiftc src/WhitePad.iPad/WhitePad.iPad/Features/Join/JoinLink.swift \
  src/WhitePad.iPad/WhitePad.iPad/App/DeepLinkRouter.swift \
  src/WhitePad.iPad/WhitePad.iPad/Shared/WhitePadError.swift \
  src/WhitePad.iPad/tools/verify-join.swift -o /tmp/whitepad-verify-join
/tmp/whitepad-verify-join
```

`CompatibilityTests` also contains XCTest versions for an Xcode-enabled environment (`swift test --package-path src/WhitePad.iPad`). The existing Xcode `DeepLinkRouterTests` gains a WebRTC transition test. Foundation checks do not validate SwiftUI presentation, Universal Link association or native Pencil behavior.

## Physical-device acceptance

Use the actual supported Safari/iPadOS versions and school Wi-Fi, including a classroom with 28 devices. Check Pencil handwriting, pressure, palm rejection, all shapes, erasing, undo/redo, backgrounds, QR joining, confidence, answered status, question mode and teacher controls. Test portrait/landscape, split view, Safari toolbar changes, keyboard and accidental finger touches. Check local recovery after refresh, Safari process eviction, network changes and an iPad sleeping through clear/lock/kick/question commands. Verify TURN with UDP disabled and the relay-only preview. Check a lesson crossing TURN credential expiry and browser background suspension.

These checks require Xcode for the complete Swift app and real devices for Pencil, sleep, network and performance behavior. Chromium or Playwright WebKit is not evidence that physical iPad Safari/Pencil works.
