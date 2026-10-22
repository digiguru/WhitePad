> Historical SignalR-era planning notes. For the current native WebRTC implementation, build instructions and limitations, read [Native iPad WebRTC](../../../docs/webrtc/ipad-transition.md). The C#/SignalR deployment path is retired in source.

# Testing And Deployment

## Test Matrix

Test on:

- latest basic iPad model available
- previous basic iPad model available
- iPadOS current school version
- landscape and portrait
- Apple Pencil and finger input
- school Wi-Fi
- local development LAN

## Join Tests

- QR opens Safari when app is not installed.
- QR opens native app when universal links are configured.
- Custom scheme fallback opens native app.
- Invalid token shows clear error.
- Missing token shows clear error.
- Missing room ID shows clear error.
- Room full shows server error.
- Student can re-scan a new room QR after being in a previous room.

## Classroom Flow Tests

- Student joins while waiting room is disabled.
- Student joins while waiting room is enabled and locked.
- Teacher starts activity.
- Student taps `Join Room`.
- Teacher locks one student.
- Teacher unlocks one student.
- Teacher locks all students.
- Teacher unlocks all students.
- Teacher kicks student.
- Teacher clears one board.
- Teacher clears all boards.
- Teacher changes question.
- Student toggles answered.
- Student changes confidence.

## Drawing Tests

- Pen strokes appear live on teacher dashboard.
- Stroke pressure is reflected locally and/or transmitted consistently.
- No accidental drawing from palm contact.
- Multi-touch does not corrupt the active stroke.
- Undo updates local board and teacher tile.
- Redo updates local board if represented locally.
- Clear updates local board and teacher tile.
- Background changes do not affect transmitted coordinates.
- Shapes preview correctly and commit once.
- Shape coordinates match teacher tile rendering.
- Eraser behavior matches teacher dashboard rendering.

## Network Tests

- App starts when server is reachable.
- App shows useful error when server is unreachable.
- App handles Wi-Fi interruption during drawing.
- App handles server restart.
- App handles iPad sleep/wake.
- App handles app background/foreground.

## Performance Targets

The app should stay responsive while drawing with:

- 28 students connected to one room.
- continuous Pencil input for at least 10 minutes.
- teacher dashboard showing live thumbnails.
- basic iPad hardware from the last two years.

Watch:

- frame drops while drawing
- growing memory from stroke history
- SignalR send backlog
- battery drain during long classes

## Deployment Options

TestFlight:

- good for pilot groups
- simple external testing
- limited classroom management

Apple School Manager / MDM:

- best for school-owned iPads
- supports managed app deployment
- can enforce app installation and network settings

Direct local install from Xcode:

- useful only during development
- not suitable for classroom rollout

## Server And Certificate Notes

iPadOS is strict about HTTPS trust. For school LAN use, choose one of:

- stable HTTPS domain with trusted certificate
- school-managed certificate authority installed on iPads
- development-only exception in debug builds

Avoid relying on students bypassing certificate warnings. That is not reliable in managed classrooms and weakens trust in the QR flow.

## Pilot Checklist

- Teacher can create room.
- Projected QR code is scannable from classroom distance.
- At least 10 iPads can join in under 2 minutes.
- Teacher can see all connected students.
- Drawing appears within acceptable latency.
- Lock, clear, question, answered, and confidence controls work.
- App recovers acceptably from one Wi-Fi interruption.
- Students know whether to scan with Camera, Safari, or the WhitePad app.
