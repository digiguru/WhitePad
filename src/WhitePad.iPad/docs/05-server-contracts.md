> Historical SignalR-era planning notes. For the current native WebRTC implementation, build instructions and limitations, read [Native iPad WebRTC](../../../docs/webrtc/ipad-transition.md). The C#/SignalR deployment path is retired in source.

# Server Contracts

The iPad app should use the existing SignalR hub:

```text
/hub/whiteboard
```

## Hub Methods Used By Student Client

```text
JoinRoomAsStudent(roomId, joinToken, displayName) -> JoinRoomResponse
SendStrokeBatch(batch)
SendShape(shape)
SetConfidence(confidenceLevel)
UndoStroke(strokeId)
ClearBoard()
JoinFromWaitingRoom()
SetAnswered(hasAnswered)
```

## Events The iPad Client Must Handle

```text
studentLocked
boardCleared
waitingRoomStateChanged
kicked
questionChanged
```

The student app does not need to handle teacher-only events such as `participantJoined`, `participantLeft`, `receiveStrokeBatch`, `receiveShape`, `strokeUndone`, or `answeredChanged`.

## JoinRoomResponse

```json
{
  "success": true,
  "studentId": "string",
  "displayName": "string",
  "roomSettings": {},
  "isLocked": false,
  "waitingRoomEnabled": false,
  "waitingRoomUnlocked": false,
  "currentQuestion": null,
  "error": null
}
```

On failure:

```json
{
  "success": false,
  "error": "Room not found"
}
```

Known errors:

- `Room not found`
- `Invalid or expired join token`
- `Room is full (max N students)`

## StrokeBatch

```json
{
  "studentId": "set by server",
  "strokeId": "string",
  "points": [
    {
      "x": 0.5,
      "y": 0.5,
      "pressure": 0.8,
      "timestamp": 123
    }
  ],
  "color": "#000000",
  "lineWidth": 2,
  "isEraser": false,
  "backgroundType": "none",
  "paperColor": "white",
  "isComplete": false
}
```

Client rules:

- Generate stable `strokeId` per stroke.
- Send batches while drawing.
- Send final batch with `isComplete == true`.
- Do not trust client-side `studentId`; the server replaces it.
- Use normalized coordinates so teacher tiles can render at any size.
- Include the active `backgroundType` and `paperColor` on stroke batches so teacher thumbnails can repaint paper changes immediately and render eraser strokes in the correct paper colour.

Eraser rules:

- Prefer the first-class `isEraser == true` flag.
- Set `color` to `__WHITEPAD_ERASER__` for compatibility with the current web teacher renderer.
- Send a negative `lineWidth` for compatibility with existing web eraser batches. The absolute value is the eraser width.
- Current web stroke IDs also include `-eraser-`; native code should not rely on that as the primary signal, but it is useful while both clients coexist.
- Render eraser strokes as paper-coloured cover strokes, not black strokes. On buff paper, teacher thumbnails must use the buff colour too.

## Shape

```json
{
  "shapeId": "string",
  "studentId": "set by server",
  "type": "line",
  "points": [
    { "x": 0.1, "y": 0.1, "pressure": 0.5 },
    { "x": 0.9, "y": 0.9, "pressure": 0.5 }
  ],
  "color": "#000000",
  "lineWidth": 2,
  "backgroundType": "none",
  "paperColor": "white",
  "isComplete": true
}
```

Supported shape types:

```text
line
rectangle
circle
arrow
axesL
axesCross
```

Background values currently used by the web client:

```text
none
dotted
lined
grid
```

Paper colour values currently used by the web client:

```text
white
buff
```

The iPad client should treat paper colour as board state, not as a drawing stroke. Changing paper colour should send an update immediately, even if no new pen stroke follows.

## Confidence

Allowed values:

```text
none
red
amber
green
```

Invoke:

```text
SetConfidence("green")
```

## Locking

`studentLocked` message:

```json
{
  "studentId": "string",
  "isLocked": true
}
```

Only apply the lock if the message matches the current `studentId`.

## Waiting Room

`waitingRoomStateChanged` message:

```json
{
  "waitingRoomEnabled": true,
  "waitingRoomUnlocked": false
}
```

State rule:

- If waiting room is enabled and the student is locked, show waiting room UI.
- If waiting room is unlocked, show `Join Room`.
- When the student invokes `JoinFromWaitingRoom`, the server sends `studentLocked` with `isLocked == false`.

## Question And Answered State

`questionChanged` message:

```json
{
  "question": "string or null"
}
```

Client behavior:

- Set current question.
- Reset local answered state to false.
- Invoke `SetAnswered(true|false)` when the student toggles the answered button.

## Compatibility Risks

The web app's documented query string has historically used both `room` and `roomId` in docs, but current code expects `roomId`. The iPad app should accept both for robustness and prefer `roomId`.
