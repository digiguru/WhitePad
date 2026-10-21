import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { StrokeBatcher } from '../strokeBatching';

describe('StrokeBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it.each([['webrtc', 100], ['signalr', 50]] as const)('uses the %s batching interval independently of local configuration', (transport, interval) => {
    vi.stubEnv('VITE_TRANSPORT', transport);
    const onBatch = vi.fn();
    const batcher = new StrokeBatcher('default-interval', onBatch);
    batcher.addPoint({ x: 0.1, y: 0.2, pressure: 1 });
    vi.advanceTimersByTime(interval - 1);
    expect(onBatch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onBatch).toHaveBeenCalledTimes(1);
    batcher.cancel();
  });

  it('batches points and flushes on interval', () => {
    const onBatch = vi.fn();
    const batcher = new StrokeBatcher('stroke-1', onBatch, 50);

    batcher.addPoint({ x: 0.1, y: 0.2, pressure: 0.5 });
    batcher.addPoint({ x: 0.2, y: 0.3, pressure: 0.6 });

    expect(onBatch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);

    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(onBatch).toHaveBeenCalledWith({
      strokeId: 'stroke-1',
      points: [
        { x: 0.1, y: 0.2, pressure: 0.5 },
        { x: 0.2, y: 0.3, pressure: 0.6 },
      ],
      isComplete: false,
    });
  });

  it('flushes immediately when requested and clears timer', () => {
    const onBatch = vi.fn();
    const batcher = new StrokeBatcher('stroke-2', onBatch);

    batcher.addPoint({ x: 0.4, y: 0.5, pressure: 0.7 });
    batcher.flush(true);

    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(onBatch).toHaveBeenCalledWith({
      strokeId: 'stroke-2',
      points: [{ x: 0.4, y: 0.5, pressure: 0.7 }],
      isComplete: true,
    });

    vi.advanceTimersByTime(50);
    expect(onBatch).toHaveBeenCalledTimes(1);
  });
  it('supports 100ms batches, flushes empty pen-up and cancels pending gestures', () => {
    const onBatch = vi.fn();
    const batcher = new StrokeBatcher('peer-stroke', onBatch, 100);
    batcher.addPoint({ x: 0.1, y: 0.2, pressure: 1 });
    vi.advanceTimersByTime(99); expect(onBatch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(onBatch).toHaveBeenCalledTimes(1);
    batcher.flush(true); expect(onBatch.mock.calls[1][0].isComplete).toBe(true);
    batcher.addPoint({ x: 0.2, y: 0.3, pressure: 1 }); batcher.cancel();
    vi.advanceTimersByTime(200); expect(onBatch).toHaveBeenCalledTimes(2);
  });

});
