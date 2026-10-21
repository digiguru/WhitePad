import { StrokeBatch, StrokePoint } from '../types/messages';

export class StrokeBatcher {
  private points: StrokePoint[] = [];
  private batchInterval: number;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private strokeId: string,
    private onBatch: (batch: Partial<StrokeBatch>) => void,
    intervalMs = import.meta.env.VITE_TRANSPORT === 'webrtc' ? 100 : 50
  ) { this.batchInterval = Math.max(25, Math.min(250, intervalMs)); }

  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.points = [];
  }

  addPoint(point: StrokePoint) {
    this.points.push(point);
    if (this.points.length >= 256) this.flush();

    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.batchInterval);
    }
  }

  flush(isComplete = false) {
    if (this.points.length > 0 || isComplete) {
      this.onBatch({
        strokeId: this.strokeId,
        points: [...this.points],
        isComplete,
        // color and lineWidth will be added by the caller
      });
      this.points = [];
    }

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
