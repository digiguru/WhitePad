> Historical SignalR-era planning notes. For the current native WebRTC implementation, build instructions and limitations, read [Native iPad WebRTC](../../../docs/webrtc/ipad-transition.md). The C#/SignalR deployment path is retired in source.

# Product Scope

## Goal

Create a native iPad student client for WhitePad that connects to the existing teacher server and provides the same student functionality as the current web front end.

The iPad app is for students. The teacher experience remains in the web app unless a later phase explicitly adds a teacher iPad client.

## Target Devices

Assume school-owned basic iPads released in the last two years. Planning assumptions:

- iPadOS 17 or newer as the practical minimum unless school device inventory requires older support.
- Apple Pencil support should be optimized, but finger drawing must still work.
- Landscape should be the primary classroom layout.
- Devices may be managed through MDM and may have restricted Safari/app settings.
- Network is likely a school LAN with local HTTPS certificates or a trusted internal host.

## Feature Parity With Web Student Client

The native iPad app must support:

- QR/link room launch using `roomId` and `joinToken`.
- Student name entry.
- SignalR connection to `/hub/whiteboard`.
- Join as student via `JoinRoomAsStudent(roomId, joinToken, displayName)`.
- Waiting room states:
  - locked waiting room
  - teacher unlocked waiting room
  - explicit student `Join Room`
- Classroom lock overlay when teacher locks drawing.
- Drawing tools:
  - pen
  - eraser
  - line
  - rectangle
  - circle
  - arrow
  - L-shaped axes
  - cross axes
- Backgrounds:
  - none
  - dotted
  - lined
  - square grid
- Color picker matching the web palette.
- Thickness picker matching the web values.
- Undo, redo, and clear board.
- Teacher-initiated clear board.
- Confidence traffic light:
  - none
  - red
  - amber
  - green
- Teacher question banner.
- Answered/not answered toggle.
- Kicked/removal state.

## Native iPad Improvements

Native app work should improve:

- Apple Pencil latency and pressure capture.
- Palm rejection and single-active-stroke handling.
- Reliable full-screen classroom layout.
- App relaunch from QR code without students choosing between browser and app.
- Better reconnection and offline messaging when the school network is unstable.
- Managed deployment through TestFlight, Apple School Manager, or MDM.

## Non-Goals For First Release

- Teacher dashboard in the iPad app.
- Offline board submission after leaving the room.
- Student account login.
- Persistent personal boards across rooms.
- Server protocol redesign.
- Multi-room switching inside the app.
