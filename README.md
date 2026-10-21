# WhitePad - Live Mini-Whiteboards Web App

WhitePad is a real-time classroom whiteboard system. Students join from iPad Safari and draw on personal boards; teachers monitor all boards live and control classroom flow.

**Live demo**: https://whiteboard.mrhall.dev

## Docs Index

- `docs/WhitePad Project Plan.md`
- `docs/TESTING-README.md`
- `docs/stage0-architecture.md`
- `docs/stage0-message-contracts.md`
- `docs/stage0-wireframes.md`
- `docs/stage0-repo-structure.md`
- `docs/stage1-completion.md`
- `docs/stage2-completion.md`
- `docs/stage3-completion.md`
- `docs/stage3-implementation-plan.md`
- `docs/simplification-improvements-review.md`
- `docs/stage4-regression-test-matrix.md`
- `docs/handover-2026-05-20.md`

## Current Status

- Stages 0–3: complete
- Stage 4 (iPad hardening/testing): in progress

Stage 4 work shipped so far:

- Simplified join flow: students land directly on the drawing canvas (no waiting room)
- Classroom lock overlay: teacher can freeze editing without removing students from canvas
- iPad palm/multi-touch rejection: single active pointer, stylus-first support
- iOS toolbar picker overlay fix: colour/background popups render above canvas
- Question mode: teacher pushes a question to all students; students mark themselves answered
- Native iPad app (Swift/SwiftUI): full drawing tool parity with web client
- Docker containerisation: multi-stage Dockerfile, image pushed to GHCR on each `main` push
- Cloudflare Tunnel deployment: app is live at https://whiteboard.mrhall.dev
- Regression matrix and frontend unit tests for lock/join transitions

## Stack

- Backend: ASP.NET Core 8 + SignalR
- Frontend: React 18 + TypeScript + Vite
- Native iPad: Swift / SwiftUI (PencilKit-style pointer handling)
- Drawing: Pointer Events API, dual-canvas architecture
- Deployment: Docker → GHCR → Cloudflare Tunnel

## Quick Start

### Prerequisites

- .NET 8 SDK
- Node.js 20+

### Install

```bash
cd src/WhitePad.Server
dotnet restore

cd ../WhitePad.Web
npm install
```

### Dev Run (fast iteration)

Terminal 1:
```bash
cd src/WhitePad.Server
dotnet run
```

Terminal 2:
```bash
cd src/WhitePad.Web
npm run dev
```

### Production-Like Run (recommended for QR/iPad validation)

```bash
cd src/WhitePad.Web
npm run build

cd ../WhitePad.Server
dotnet run
```

Open:
- Teacher: `https://localhost:5001/teacher`
- Student: `https://localhost:5001/join?room=<roomId>&token=<token>`

For LAN iPad testing, run backend bound to your LAN address and use the generated join QR/link.

### Docker

```bash
docker build -t whitepad .
docker run -p 8080:8080 whitepad
```

The container exposes HTTP on port 8080. The GitHub Actions workflow (`docker.yml`) builds and pushes `ghcr.io/mrhallksc/whitepad:latest` automatically on every push to `main`.

## Implemented Features

- Room creation and student join via QR/link + token
- Live teacher grid with student thumbnails (200×150 px tiles)
- Tools: pen, eraser, line, rectangle, circle, arrow, L-axes, cross-axes
- Backgrounds: none, dotted, lined, square grid; paper colours: white, buff
- Undo/redo (Ctrl+Z/Y), clear board (student + teacher controls)
- Confidence indicators and teacher confidence summary
- Classroom lock overlay (read-only board while locked, student stays on canvas)
- Teacher kick and per-student clear controls
- Question mode (teacher broadcasts a question; students mark answered)
- Native iPad app with full drawing tool parity, floating tool palette, edge-to-edge canvas
- iPad input hardening: single-pointer, palm rejection, iOS picker z-index fix

## Testing

Backend tests:
```bash
dotnet test tests/WhitePad.Server.Tests/WhitePad.Server.Tests.csproj
```

Frontend tests (Vitest):
```bash
cd src/WhitePad.Web
npm run test
```

Run all tests (PowerShell):
```powershell
./scripts/run-tests.ps1
```

Manual regression matrix: `docs/stage4-regression-test-matrix.md`

Full testing guide: `docs/TESTING-README.md`

## Documentation

- `docs/WhitePad Project Plan.md` — full project plan and staged roadmap
- `docs/TESTING-README.md` — automated + manual testing guide
- `docs/stage0-architecture.md` — architecture and deployment models
- `docs/stage0-message-contracts.md` — SignalR message contracts
- `docs/stage0-wireframes.md` — UI wireframes
- `docs/stage0-repo-structure.md` — repository structure plan
- `docs/stage1-completion.md` — Stage 1 completion report
- `docs/stage2-completion.md` — Stage 2 completion report
- `docs/stage3-completion.md` — Stage 3 completion report
- `docs/stage3-implementation-plan.md` — Stage 3 implementation plan (historical)
- `docs/simplification-improvements-review.md` — simplification recommendations + status
- `docs/stage4-regression-test-matrix.md` — Stage 4 manual regression checklist
- `docs/handover-2026-05-20.md` — May 2026 handover: join flow simplification + native iPad parity

## Next Priorities

1. Validate QR join flow and all drawing tools on real iPads over LAN/Wi-Fi.
2. Integrate pressure + smoothing (Perfect Freehand) for Apple Pencil strokes.
3. Expand automated frontend tests around lock and join interactions.
4. Move to Stage 5 (advanced classroom controls) once Stage 4 matrix is green.

Last updated: 2026-05-20

## WebRTC migration (feature branch)

A static Vite frontend, Cloudflare Durable Object signalling/control plane, and authenticated TURN integration are available behind `VITE_TRANSPORT=webrtc`. The existing SignalR build remains the default during migration.

- [Migration status and remaining tasks](docs/webrtc/README.md)
- [Architecture and security](docs/webrtc/architecture.md)
- [Versioned drawing and recovery protocol](docs/webrtc/protocol.md)
- [Local setup, environment variables, deployment and rollback](docs/webrtc/deployment.md)
- [Native iPad transition](docs/webrtc/ipad-transition.md)
- [Tests, load results and device acceptance](docs/webrtc/verification.md)
- [Cost assumptions and sensitivity model](docs/webrtc/costs.md)
