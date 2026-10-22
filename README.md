# WhitePad

A classroom whiteboard with a static React/Vite frontend, TypeScript Cloudflare signalling and student-to-teacher WebRTC data channels. Each teacher receives only their classroom's boards. Drawing renders locally; ordinary drawing does not pass through Vercel or the signalling server.

## Development

```bash
cd src/WhitePad.Signalling
npm ci
# Configure ignored .dev.vars using .dev.vars.example, then:
npm run dev
```

In another terminal:

```bash
cd src/WhitePad.Web
npm ci
VITE_SIGNALLING_URL=http://localhost:8787 npm run dev
```

`npm run build` in `src/WhitePad.Web` outputs `dist`. Set `VITE_SIGNALLING_URL` to the deployed Worker for a hosted build. WebRTC is unconditional; `VITE_TRANSPORT` is obsolete. The native Swift app uses the same protocol over libwebrtc; configure its public origins in Info.plist and build using Xcode.

## Checks

```bash
npm test --prefix src/WhitePad.Web
npm run build --prefix src/WhitePad.Web
npm run check --prefix src/WhitePad.Signalling
npm run test:deploy --prefix src/WhitePad.Signalling
npm run test:quota --prefix src/WhitePad.Signalling
node tools/webrtc/build-native-protocol.mjs
```

GitHub Actions gates Cloudflare deployment on backend, browser and native checks. Vercel keeps its Git integration and production deployment checks. There is no C#/SignalR server, .NET build, legacy Docker release or transport fallback in this branch. Existing deployed services are not automatically shut down by removing their source. Older installed iPad apps must be updated or students can join in Safari.

## Documentation

- [Architecture and migration status](docs/webrtc/README.md)
- [Deployment and environment variables](docs/webrtc/deployment.md)
- [Native iPad integration](docs/webrtc/ipad-transition.md)
- [Protocol](docs/webrtc/protocol.md)
- [Verification and known capacity limits](docs/webrtc/verification.md)
- [Cost assumptions](docs/webrtc/costs.md)

The interrupted 400-participant soak is deferred. Sustained 400-user capacity and physical iPad acceptance remain unverified. Board recovery is local, not a durable cloud backup. Older stage documents describe historical implementations and are not deployment instructions for this architecture.
