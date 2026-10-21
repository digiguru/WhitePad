> Historical SignalR-era planning notes. For the current native WebRTC implementation, build instructions and limitations, read [Native iPad WebRTC](../../../docs/webrtc/ipad-transition.md). The C#/SignalR deployment path is retired in source.

# Student Experience

## Screen Flow

```text
QR scan or link open
  -> Resolve join link
  -> Connect to server
  -> Enter name
  -> Join room
  -> Waiting room or drawing board
```

## Launch From QR

When launched from a QR code, the app should:

1. Parse `roomId`, `token`, and server host.
2. Show a lightweight connecting state.
3. Establish SignalR connection to `/hub/whiteboard`.
4. Ask for the student name.
5. Invoke `JoinRoomAsStudent`.
6. Move to waiting room or board based on response.

If the app is already open in another room, show a confirmation before switching rooms.

## Name Entry

Match the web behavior:

- Name is required.
- Trim whitespace.
- Maximum length: 50 characters.
- Disable join button while joining.
- Show server errors such as room full, room not found, or invalid token.

Optional native improvement:

- Remember last used first name locally on the device, but require confirmation before joining.

## Waiting Room

When `waitingRoomEnabled == true` and the student is locked:

- Show a waiting room screen.
- Display the joined name.
- If `waitingRoomUnlocked == false`, show "Waiting for teacher to start activity".
- If `waitingRoomUnlocked == true`, show a clear `Join Room` button.
- On button tap, invoke `JoinFromWaitingRoom`.

## Drawing Board

The drawing board should prioritize space for student work.

Recommended landscape layout:

```text
+-------------------------------------------------------------+
| toolbar | question banner, when set                         |
|         +---------------------------------------------------+
|         |                                                   |
|         | drawing canvas                                    |
|         |                                                   |
|         |                                                   |
+-------------------------------------------------------------+
```

Toolbar controls:

- collapse/expand
- tool selector
- background selector for none, dotted, lined, and square grid
- paper colour selector for white and buff
- color selector
- thickness selector
- undo
- redo
- clear
- confidence buttons

Use native iPad controls where they improve speed, but keep labels and choices consistent with the web app.

## Tools

Pen:

- stream stroke batches during drawing
- include pressure
- use normalized coordinates

Eraser:

- show an eraser cursor before Pencil/finger contact, matching the web student view
- render local eraser movement as paper-coloured cover strokes
- send eraser strokes as stroke batches with `isEraser == true`
- keep compatibility fields while the web teacher renderer supports both clients: `color == "__WHITEPAD_ERASER__"` and negative `lineWidth`
- use the current paper colour for teacher rendering, so erasing on buff paper draws buff cover strokes rather than white or black marks

Shapes:

- preview while dragging
- commit on Pencil/finger up
- send one `Shape` message when complete

Supported shapes:

- line
- rectangle
- circle
- arrow
- L-shaped axes
- cross axes

Background and paper:

- render backgrounds on a separate layer from drawing content
- support plain, dotted, ruled, and square grid backgrounds
- support white and buff paper
- apply paper colour changes immediately and notify the teacher without waiting for the next stroke
- preserve backgrounds through eraser, undo, redo, and clear operations

## Question Banner

When the teacher sets a question:

- Show the question above the board.
- Reset local `hasAnswered` to false.
- Provide an answered toggle.
- Invoke `SetAnswered(hasAnswered)` on changes.

The server currently truncates questions to 280 characters.

## Locking

Classroom lock:

- keep the board visible
- prevent drawing, clear, undo, redo, confidence changes if matching web behavior
- show an overlay: "Drawing is locked by your teacher"

Waiting room lock:

- show waiting room screen instead of board
- unlock only after teacher starts the activity and student taps `Join Room`

## Kicked State

When the app receives `kicked`:

- stop the room session
- show a modal or full-screen message explaining the teacher removed the student
- offer a scan-again or close action
- do not silently rejoin with the old token

## Error And Reconnect States

The app should distinguish:

- cannot reach server
- invalid or expired token
- room full
- room ended or removed
- Wi-Fi dropped after successful join

For temporary network loss:

- show reconnecting overlay
- keep the board visible
- pause sends while disconnected
- avoid replaying old strokes unless a server-side resume protocol is added
