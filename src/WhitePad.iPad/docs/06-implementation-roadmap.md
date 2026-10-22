> Historical SignalR-era planning notes. For the current native WebRTC implementation, build instructions and limitations, read [Native iPad WebRTC](../../../docs/webrtc/ipad-transition.md). The C#/SignalR deployment path is retired in source.

# Implementation Roadmap

## Stage 0 - Project Setup

- Create `src/WhitePad.iPad` as an Xcode project or Swift Package-backed app.
- Set deployment target after confirming school iPadOS versions.
- Add basic SwiftUI app shell.
- Add app icons, bundle id, and signing setup.
- Add debug configuration for local server hosts.

Deliverable: app launches to an idle screen and can parse a pasted join URL.

Current implementation note: Stage 0 is the first stage being implemented in this folder. It should stay deliberately small: a buildable SwiftUI iPad app, a join-link parser, and visible parsed-link feedback. Live SignalR joining begins in Stage 1.

## Stage 1 - Join Flow And SignalR

- Add SignalR Swift client dependency.
- Implement `WhiteboardHubClient`.
- Implement typed DTOs for join response and core events.
- Add join URL parser.
- Add name entry screen.
- Invoke `JoinRoomAsStudent`.
- Show success and server error states.

Deliverable: student can join a live web-created room from the iPad app.

Current implementation note: Stage 1 uses a small native SignalR JSON/WebSocket client for the join flow only. It negotiates with `/hub/whiteboard`, invokes `JoinRoomAsStudent`, and shows a joined confirmation screen. Broader realtime event handling starts in Stage 2.

## Stage 2 - Waiting Room, Locking, Question, Confidence

- Handle `waitingRoomStateChanged`.
- Handle `studentLocked`.
- Implement waiting room screen.
- Implement `JoinFromWaitingRoom`.
- Add question banner.
- Implement answered toggle.
- Implement confidence traffic light.
- Handle `kicked`.

Deliverable: app participates correctly in teacher classroom flow without drawing yet.

Current implementation note: Stage 2 handles waiting-room state, lock/unlock, teacher questions, answered state, confidence updates, and kicked state. Drawing is still intentionally absent until Stage 3.

## Stage 3 - Drawing MVP

- Implement drawing surface.
- Capture Pencil/finger input.
- Normalize points.
- Implement stroke batching.
- Invoke `SendStrokeBatch`.
- Render local strokes.
- Implement color and thickness.
- Implement basic undo, redo, and clear.
- Handle teacher `boardCleared`.

Deliverable: teacher web dashboard receives live iPad strokes.

Current implementation note: Stage 3 now has the first native drawing loop: a fixed black pen, normalized local strokes, 50ms-ish stroke batching to `SendStrokeBatch`, local rendering, undo, clear, and teacher-triggered board clear handling. Color/thickness pickers and redo are intentionally deferred to tool-parity work.

## Stage 4 - Tool Parity

- Add eraser.
- Add line, rectangle, circle, arrow, L-axes, and cross-axes.
- Implement shape preview.
- Invoke `SendShape`.
- Add background renderer for none, dotted, lined, and square grid.
- Add white and buff paper colours.
- Send paper/background state changes immediately so the teacher dashboard updates without waiting for a drawing stroke.
- Render eraser strokes in the active paper colour on both local and teacher views.
- Tune toolbar for classroom speed.

Deliverable: native app matches current web student feature set.

Current implementation note: Stage 4 has its first native tool-parity slice. The iPad drawing screen now has a classroom-speed toolbar with pen/eraser/shapes, colour and thickness controls, white/buff paper, none/dotted/lined/square backgrounds, shape preview, local undo/redo/clear, `SendShape`, and immediate background sync metadata. The remaining Stage 4 hardening is mostly hands-on iPad tuning: Pencil pressure/smoothing, toolbar ergonomics on real devices, and latency checks against the teacher dashboard.

## Stage 5 - QR Launch

- Add custom URL scheme.
- Add universal link handling where deployment host allows it.
- Update web join page with app-open fallback if needed.
- Test QR launch from Camera and Safari.
- Confirm behavior when app is already open.

Deliverable: one teacher QR code can launch app or web join flow.

## Stage 6 - Reliability And Classroom Hardening

- Add reconnect state.
- Add connection timeout messaging.
- Add server certificate guidance.
- Tune drawing performance on target basic iPads.
- Validate memory and battery usage.
- Add local logs useful for teacher/admin troubleshooting.

Deliverable: app is safe for pilot classroom use.

## Stage 7 - Distribution

- Prepare TestFlight build.
- Prepare Apple School Manager or MDM deployment path.
- Document server URL/certificate setup.
- Produce pilot checklist.

Deliverable: deployable app for a managed iPad classroom.

## Suggested First Milestone

Build through Stage 2 before investing deeply in drawing. That proves the native app can connect to the existing room lifecycle and teacher controls. Then drawing work can proceed against a stable session foundation.
