import { describe, expect, it } from "vitest";
import { DEFAULT_RENDER } from "../../miniprogram/tryon/engine";
import { RegionTracker } from "../../miniprogram/tryon/tracker";

const a = { x: .32, y: .5, radius: .06 }, b = { x: .7, y: .5, radius: .06 };
const options = { ...DEFAULT_RENDER, mode: "effect" as const, outline: false };
export function movingFrame(dx = 0, radius = 12, visible = true, lighting = 0) {
  const width = 100, height = 80, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const patch = visible && Math.hypot(x + .5 - 32 - dx, y + .5 - 40) < radius;
    data.set((patch ? [227, 198, 181, 255] : [158, 111, 86, 255]).map((v, c) => c < 3 ? v + lighting : v), (y * width + x) * 4);
  }
  return { width, height, data };
}
describe("bounded camera-region tracking", () => {
  it("tracks gradual translation and renders the new position, leaving original pixels intact", () => {
    const tracker = new RegionTracker(movingFrame(), a, b);
    for (const shift of [2, 4, 7, 10]) {
      const frame = movingFrame(shift), original = frame.data.slice();
      const result = tracker.process(frame, options);
      expect(result.status).toBe("tracking");
      expect(result.center.x).toBeCloseTo((32 + shift) / 100, 1);
      expect(result.pixels[(40 * 100 + 32 + shift) * 4]).toBeLessThan(227);
      expect(frame.data).toEqual(original);
    }
  });
  it("withdraws on occlusion and restores only after two consistent local detections", () => {
    const tracker = new RegionTracker(movingFrame(), a, b);
    const missing = movingFrame(0, 12, false);
    expect(tracker.process(missing, options)).toMatchObject({ status: "lost", pixels: missing.data });
    const returned = movingFrame();
    expect(tracker.process(returned, options)).toMatchObject({ status: "lost", pixels: returned.data });
    expect(tracker.process(returned, options).status).toBe("tracking");
    expect(tracker.layer()?.distances.some(v => v > 0)).toBe(true);
  });
  it("expires after sustained loss and does not reacquire a distant region", () => {
    const tracker = new RegionTracker(movingFrame(), a, b);
    for (let i = 0; i < 20; i++) expect(tracker.process(movingFrame(40)).status).toBe("lost");
    expect(tracker.expired).toBe(true);
    expect(tracker.process(movingFrame(), options).status).toBe("lost");
    expect(tracker.layer()).toBeNull();
  });
  it("does not restore makeup when local recovery candidates jump between positions", () => {
    const tracker = new RegionTracker(movingFrame(), a, b);
    expect(tracker.process(movingFrame(0, 12, false)).status).toBe("lost");
    expect(tracker.process(movingFrame(-7)).status).toBe("lost");
    expect(tracker.process(movingFrame(7)).status).toBe("lost");
    expect(tracker.layer()).toBeNull();
    expect(tracker.process(movingFrame(7)).status).toBe("tracking");
  });
  it.each([30, -25])("rejects sudden displacement %s", dx => {
    const tracker = new RegionTracker(movingFrame(), a, b);
    const frame = movingFrame(dx);
    expect(tracker.process(frame, options)).toMatchObject({ status: "lost", pixels: frame.data });
  });
  it("rejects sudden area growth and a large light change", () => {
    for (const frame of [movingFrame(0, 22), movingFrame(0, 12, true, -65)]) {
      const tracker = new RegionTracker(movingFrame(), a, b);
      expect(tracker.process(frame, options)).toMatchObject({ status: "lost", pixels: frame.data });
    }
  });
  it("rejects changed frame dimensions without drawing an old mask", () => {
    const tracker = new RegionTracker(movingFrame(), a, b);
    const frame = { width: 80, height: 100, data: movingFrame().data };
    expect(tracker.process(frame, options)).toMatchObject({ status: "lost", pixels: frame.data });
  });
  it("rejects overlapping/indistinguishable seeds and edge-touching calibration", () => {
    expect(() => new RegionTracker(movingFrame(), a, a)).toThrow(/重叠/);
    expect(() => new RegionTracker(movingFrame(0, 12, false), a, b)).toThrow(/接近/);
    expect(() => new RegionTracker(movingFrame(-25), { ...a, x: .07 }, b)).toThrow(/边缘/);
  });
  it("clears calibration buffers and refuses reuse after disposal", () => {
    const tracker = new RegionTracker(movingFrame(), a, b);
    expect(tracker.preview(options).length).toBe(32000);
    tracker.dispose();
    expect(() => tracker.preview(options)).toThrow();
    expect(() => tracker.process(movingFrame(), options)).toThrow();
  });
});
