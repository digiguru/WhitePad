> Historical SignalR-era planning notes. For the current native WebRTC implementation, build instructions and limitations, read [Native iPad WebRTC](../../../docs/webrtc/ipad-transition.md). The C#/SignalR deployment path is retired in source.

# QR Code And Deep Linking

## Current Join URL

The server currently creates join URLs in this shape:

```text
https://<host>:5001/join?roomId=<roomId>&token=<joinToken>
```

This should remain the canonical room join URL.

## Recommended QR Strategy

Use the same QR code for web and app:

```text
https://<server-host>:5001/join?roomId=<roomId>&token=<joinToken>
```

Behavior:

- If the iPad app is installed and universal links are configured, iPadOS opens WhitePad directly.
- If the app is not installed, Safari opens the existing web student client.
- If universal link association fails, the page can show an "Open in WhitePad app" fallback using a custom URL scheme.

This keeps classroom instructions simple: students scan one QR code.

## Universal Links

Universal links require:

- An HTTPS host reachable by the iPads.
- An Apple App Site Association file at:

```text
https://<server-host>/.well-known/apple-app-site-association
```

- An associated domains entitlement in the app:

```text
applinks:<server-host>
```

For a LAN-hosted classroom server, this may be hard if the host changes per teacher machine. Universal links work best if WhitePad has a stable school or product domain.

## Custom URL Scheme Fallback

Add a custom scheme:

```text
whitepad://join?roomId=<roomId>&token=<joinToken>&server=https%3A%2F%2F<host>%3A5001
```

The web join page can detect iPadOS and display an app-open button:

```text
Open in WhitePad app
```

The QR code should still point at the HTTPS URL. The web page can offer the custom scheme only after Safari loads.

## QR Payload Recommendation

Keep the QR payload short and web-first:

```text
https://<host>:5001/join?roomId=<roomId>&token=<joinToken>
```

Do not encode student name, device identity, or long JSON payloads in the QR code.

## Link Parsing In The App

The app should accept both forms.

HTTPS universal link:

```text
https://<host>:5001/join?roomId=<roomId>&token=<joinToken>
```

Custom scheme:

```text
whitepad://join?roomId=<roomId>&token=<joinToken>&server=<encoded-server-url>
```

Parsed fields:

- `serverBaseUrl`
- `roomId`
- `joinToken`

Validation:

- Require `roomId`.
- Require `token`.
- Require HTTPS for production.
- Permit local development hosts through a debug build setting.

## Teacher Server Considerations

For reliable app launch, consider adding a small join landing page that:

- Confirms the room exists.
- Shows the room name.
- Shows web join form when app is not installed.
- Offers "Open in WhitePad app" on iPad.
- Explains that the student should rescan the teacher QR if the token is invalid.

## Security Notes

The join token is a bearer token. Anyone with the QR URL can join while the room exists.

Keep:

- short-lived room tokens
- room capacity limits
- teacher kick support
- optional token rotation later

Avoid:

- putting teacher control tokens in student QR codes
- storing join tokens permanently in iCloud backups
- logging full join URLs in production client analytics
