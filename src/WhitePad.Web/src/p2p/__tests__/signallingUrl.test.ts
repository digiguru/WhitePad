import { describe, expect, it } from 'vitest';
import { signallingUrl, SignallingConfigurationError } from '../signallingUrl';
describe('signalling endpoint configuration', () => {
  it('normalises a hosted Worker or custom service origin', () => {
    expect(signallingUrl(' https://whitepad-signalling.example.workers.dev/ ')).toBe('https://whitepad-signalling.example.workers.dev');
    expect(signallingUrl('https://signal.school.example')).toBe('https://signal.school.example');
  });
  it('permits HTTP only on loopback for local development', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) expect(signallingUrl(`http://${host}:8787/`)).toBe(`http://${host}:8787`);
    expect(() => signallingUrl('http://signal.school.example')).toThrow(SignallingConfigurationError);
  });
  it('rejects the TURN relay and credential API as signalling endpoints', () => {
    for (const host of ['turn.cloudflare.com', 'rtc.live.cloudflare.com']) expect(() => signallingUrl(`https://${host}`)).toThrow('deployed WhitePad signalling Worker URL');
  });
  it('rejects missing, malformed and credential-bearing endpoints', () => {
    for (const value of ['', 'not a URL', 'wss://signal.example', 'https://user:password@signal.example', 'https://signal.example/create', 'https://signal.example?key=value', 'https://signal.example#fragment'])
      expect(() => signallingUrl(value)).toThrow(SignallingConfigurationError);
  });
});
