> Historical SignalR-era planning notes. For the current native WebRTC implementation, build instructions and limitations, read [Native iPad WebRTC](../../../docs/webrtc/ipad-transition.md). The C#/SignalR deployment path is retired in source.

# App Architecture

## Recommended Stack

- SwiftUI for screens and app state.
- PencilKit or a custom Metal/Core Graphics drawing surface for input and rendering.
- SignalR Swift client for `/hub/whiteboard`.
- Swift concurrency for connection lifecycle and event dispatch.
- Codable DTOs mirroring the existing TypeScript/C# contracts.

## Architecture Shape

Use a thin native client over the existing server contract.

```text
WhitePad.iPad
  App/
    WhitePadApp
    AppRouter
    DeepLinkRouter
  Features/
    Join/
    WaitingRoom/
    Board/
    Toolbar/
    Question/
  Networking/
    WhiteboardHubClient
    HubMethod
    HubEvent
    DTOs
  Drawing/
    DrawingSurface
    StrokeBatcher
    ShapeRenderer
    BoardHistory
    BackgroundRenderer
  Shared/
    AppState
    Errors
    Logging
```

## Core State Model

The app should have a single room session state owned by an observable coordinator.

```swift
enum SessionPhase {
    case idle
    case resolvingJoinLink(JoinLink)
    case connecting(JoinLink)
    case enteringName(JoinLink)
    case joining(JoinLink, displayName: String)
    case waitingRoom(Session)
    case drawing(Session)
    case locked(Session)
    case kicked
    case failed(WhitePadError)
}
```

The session should store:

- `roomId`
- `joinToken`
- `studentId`
- `displayName`
- `isLocked`
- `waitingRoomEnabled`
- `waitingRoomUnlocked`
- `currentQuestion`
- `hasAnswered`
- `confidenceLevel`

## Networking Boundary

Create `WhiteboardHubClient` as the only type that knows about SignalR method and event names.

Responsibilities:

- Start/stop hub connection.
- Invoke hub methods.
- Register event handlers.
- Normalize reconnect errors into app-level states.
- Avoid leaking SignalR-specific types into SwiftUI views.

The rest of the app should call typed methods such as:

```swift
func joinRoomAsStudent(roomId: String, token: String, displayName: String) async throws -> JoinRoomResponse
func sendStrokeBatch(_ batch: StrokeBatch) async
func sendShape(_ shape: Shape) async
func setConfidence(_ level: ConfidenceLevel) async
func undoStroke(strokeId: String) async
func clearBoard() async
func joinFromWaitingRoom() async
func setAnswered(_ hasAnswered: Bool) async
```

## Drawing Boundary

The drawing layer should own:

- active Pencil/finger stroke tracking
- normalized coordinate conversion
- stroke batching
- local board history
- shape preview
- undo/redo stacks
- background rendering

The board should send normalized points in the same coordinate model as the web app:

```text
x: 0.0 to 1.0 relative to canvas width
y: 0.0 to 1.0 relative to canvas height
pressure: 0.0 to 1.0
```

## PencilKit Decision

Two approaches are viable.

Use PencilKit if speed of implementation is the priority. It gives good Apple Pencil behavior, palm rejection, and low-latency drawing, but exported stroke data must be converted into WhitePad's normalized `StrokeBatch` format.

Use a custom drawing surface if exact protocol parity and shape preview control are the priority. This is closer to the current web implementation and avoids reverse-mapping PencilKit strokes, but requires more work for latency, smoothing, and palm rejection.

Recommended first release: custom drawing surface with UIKit touch handling, because WhitePad already streams normalized points and shape events live to the teacher. PencilKit can be revisited if Apple Pencil feel is not good enough.

## Compatibility Rule

The iPad client should not require server changes for the first usable release. If server improvements are needed later, add them in a backward-compatible way so the web app remains fully functional.
