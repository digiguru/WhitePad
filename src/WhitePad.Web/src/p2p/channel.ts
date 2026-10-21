import { MAX_FRAME, RateLimit } from "./protocol";
export const HIGH_WATER = 256 * 1024;
export const MAX_QUEUE = 512 * 1024;
/** No unbounded queue: callers fall back to replay from canonical state. */
export class Channel {
  private queue: string[] = [];
  private bytes = 0;
  private rate = new RateLimit(400, 200);
  bytesSent = 0;
  bytesReceived = 0;
  peakBuffered = 0;
  constructor(
    readonly rtc: RTCDataChannel,
    receive: (data: any) => void,
    private overflow: () => void,
  ) {
    rtc.bufferedAmountLowThreshold = 64 * 1024;
    rtc.onbufferedamountlow = () => this.drain();
    rtc.onmessage = (e) => {
      if (
        typeof e.data !== "string" ||
        new TextEncoder().encode(e.data).length > MAX_FRAME ||
        !this.rate.take()
      ) {
        rtc.close();
        return;
      }
      this.bytesReceived += new TextEncoder().encode(e.data).length;
      try {
        receive(JSON.parse(e.data));
      } catch {
        rtc.close();
      }
    };
  }
  send(value: unknown) {
    const s = JSON.stringify(value),
      size = new TextEncoder().encode(s).length;
    if (size > MAX_FRAME) throw new Error("Oversize frame");
    if (this.bytes + size > MAX_QUEUE) {
      this.queue = [];
      this.bytes = 0;
      this.overflow();
      return false;
    }
    this.queue.push(s);
    this.bytes += size;
    this.drain();
    return true;
  }
  private drain() {
    while (
      this.rtc.readyState === "open" &&
      this.rtc.bufferedAmount < HIGH_WATER &&
      this.queue.length
    ) {
      const s = this.queue.shift()!;
      const size = new TextEncoder().encode(s).length;
      this.bytes -= size;
      this.rtc.send(s);
      this.bytesSent += size;
      this.peakBuffered = Math.max(this.peakBuffered, this.rtc.bufferedAmount);
    }
  }
  get pending() {
    return this.bytes + this.rtc.bufferedAmount;
  }
  clear() {
    this.queue = [];
    this.bytes = 0;
  }
}
export const backoff = (attempt: number, random = Math.random) =>
  Math.min(30000, 500 * 2 ** Math.min(attempt, 6)) * (0.5 + random() * 0.5);
export async function gather(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("ICE gathering timed out"));
    }, 12000);
    const check = () => {
      if (pc.iceGatheringState === "complete") {
        cleanup();
        resolve();
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
    };
    pc.addEventListener("icegatheringstatechange", check);
    check();
  });
}
