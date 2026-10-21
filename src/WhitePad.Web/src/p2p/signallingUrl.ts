export class SignallingConfigurationError extends Error {}
/** Signalling is our HTTP/WebSocket service, not the TURN relay or credential API. */
export function signallingUrl(value: string): string {
  if (!value.trim()) throw new SignallingConfigurationError('Set VITE_SIGNALLING_URL to the deployed WhitePad signalling Worker URL.');
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw new SignallingConfigurationError('VITE_SIGNALLING_URL must be an absolute HTTPS signalling service URL.'); }
  if (['turn.cloudflare.com', 'rtc.live.cloudflare.com'].includes(url.hostname))
    throw new SignallingConfigurationError('VITE_SIGNALLING_URL points to Cloudflare TURN. Set it to your deployed WhitePad signalling Worker URL, then rebuild the frontend.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new SignallingConfigurationError('VITE_SIGNALLING_URL must be an HTTPS service origin without credentials, a path or query. HTTP is allowed only for localhost development.');
  return url.origin;
}
