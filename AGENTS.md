# WhitePad contributor instructions

WhitePad is a classroom whiteboard: React 18/TypeScript/Vite static frontend on Vercel, a TypeScript Cloudflare Durable Object signalling/control backend, WebRTC data channels in a teacher/student star, and a Swift iPad client using libwebrtc. C#/SignalR and their Docker release path are retired.

Read docs/webrtc/README.md, protocol.md and deployment.md before transport changes. The executable shared protocol is src/WhitePad.Web/src/p2p/protocol.ts. Regenerate the committed JavaScriptCore resource using `node tools/webrtc/build-native-protocol.mjs` after protocol changes (frontend dependencies must be installed).

## Workflow

- Work on a codex/ feature branch and deliver a PR with validation and remaining limitations.
- Keep credentials out of Git, URLs and logs. Do not print .dev.vars or raw SDP/ICE/drawing contents.
- Never deploy, purchase services or retire an existing hosted deployment without user authorization.
- Load/soak testing is deferred by user request: do not run it unless explicitly requested again.
- Preserve drawing tools, teacher controls, QR joining, confidence and question behavior.
- Local rendering must remain independent of network delivery; authentication, control reconciliation, generation checks and bounded recovery are required in every client.
- A legitimate client pauses while disconnected from authenticated signalling; a UI lock cannot prevent malicious local drawing.

## Validation

Use the commands in README.md. Browser tests exercise real WebRTC peers; native protocol checks can use swiftc with JavaScriptCore on macOS. The full native app requires Xcode and iOS SDKs. Report physical-device and environment limitations honestly. Do not claim capacity certification from short local tests.

## React patterns

Use stable callbacks and refs for connection lifecycle and cleanup. Preserve duplicate-join guards. Do not add React.StrictMode without first making connection creation safe for its development lifecycle. Calculate canvas continuation indices before mutating point arrays and begin a new canvas path for each batch. Background and ink remain separate layers so erasing does not erase backgrounds.
