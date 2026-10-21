import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gather } from '../channel';
function connection(sdp = '', policy: RTCIceTransportPolicy = 'all') {
  return Object.assign(new EventTarget(), {
    iceGatheringState: 'gathering',
    localDescription: { sdp },
    getConfiguration: () => ({ iceTransportPolicy: policy }),
  }) as unknown as RTCPeerConnection;
}
const relay = 'a=candidate:1 1 udp 123 192.0.2.1 50000 typ relay raddr 0.0.0.0 rport 0\r\n';
const host = 'a=candidate:2 1 udp 123 192.0.2.2 50000 typ host\r\n';
describe('bounded ICE gathering', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('uses gathered relay candidates when other server transports never complete', async () => {
    const pending = gather(connection(relay, 'relay'));
    await vi.advanceTimersByTimeAsync(12000);
    await expect(pending).resolves.toBeUndefined();
  });
  it('rejects a deadline with no usable candidates', async () => {
    const result = expect(gather(connection())).rejects.toThrow('without usable candidates');
    await vi.advanceTimersByTimeAsync(12000);
    await result;
  });
  it('does not mistake a host candidate for a working forced-relay path', async () => {
    const result = expect(gather(connection(host, 'relay'))).rejects.toThrow('without usable candidates');
    await vi.advanceTimersByTimeAsync(12000);
    await result;
  });
  it('finishes promptly when gathering completes before the deadline', async () => {
    const pc = connection(relay);
    const pending = gather(pc);
    Object.assign(pc, { iceGatheringState: 'complete' });
    pc.dispatchEvent(new Event('icegatheringstatechange'));
    await expect(pending).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
