> Historical SignalR-era planning notes. For the current native WebRTC implementation, build instructions and limitations, read [Native iPad WebRTC](../../../docs/webrtc/ipad-transition.md). The C#/SignalR deployment path is retired in source.

# WhitePad iPad App Planning Docs

This folder contains the planning documents for a native iPad student client for WhitePad.

Recommended app location:

```text
src/
  WhitePad.Server/
  WhitePad.Web/
  WhitePad.iPad/
    docs/
```

The iPad app should be treated as a first-class client of the existing WhitePad SignalR server, not as a separate product. Its goal is to match the current web student experience while improving iPad-specific launch, Apple Pencil, classroom device management, and reliability.

## Documents

- [01-product-scope.md](01-product-scope.md) - goals, non-goals, target device assumptions, feature parity
- [02-app-architecture.md](02-app-architecture.md) - proposed native iPad architecture and module boundaries
- [03-qr-and-deep-linking.md](03-qr-and-deep-linking.md) - QR code, universal link, and custom URL launch strategy
- [04-student-experience.md](04-student-experience.md) - screen-by-screen student UX plan
- [05-server-contracts.md](05-server-contracts.md) - SignalR methods, events, data models, and compatibility notes
- [06-implementation-roadmap.md](06-implementation-roadmap.md) - staged build plan
- [07-testing-and-deployment.md](07-testing-and-deployment.md) - validation, classroom testing, App Store/TestFlight/MDM considerations

## Recommended Direction

Build `WhitePad.iPad` as a native SwiftUI iPad app using the existing server contract. Use the same join URL in the teacher QR code for both web and native app launch:

```text
https://<server-host>:5001/join?roomId=<roomId>&token=<joinToken>
```

When the native app is installed, iPadOS should open the app through universal links. When it is not installed, Safari should open the existing web student client. A custom URL scheme can be kept as a fallback, but the QR code should prefer the HTTPS join URL.
