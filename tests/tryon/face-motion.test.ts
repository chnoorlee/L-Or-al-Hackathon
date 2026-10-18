import { describe, expect, it } from "vitest";
import { FaceMotionTracker } from "../../miniprogram/tryon/face-motion";
import { face106, faceFrame, texturedFaceFrame } from "../fixtures/face106";

describe("short-lived face mask motion (synthetic frames, not native accuracy)", () => {
  it("aligns a delayed detection with the latest video and continues moving the mask", () => {
    const tracker = new FaceMotionTracker();
    for (let i = 0; i <= 10; i++) tracker.push(texturedFaceFrame(160, i, i / 2), 1000 + i * 33);
    const result = tracker.seed(face106(), 1000, 1330)!;
    expect(result).not.toBeNull(); expect(result.tx).toBeCloseTo(10, 0); expect(result.ty).toBeCloseTo(5, 0);
    const next = tracker.push(texturedFaceFrame(160, 11, 6), 1363)!;
    expect(next.tx).toBeCloseTo(11, 0); expect(next.ty).toBeCloseTo(6, 0);
    tracker.dispose();
  });
  it("tracks modest rotation and scale in pixel coordinates", () => {
    const tracker = new FaceMotionTracker(); tracker.push(texturedFaceFrame(), 1000); tracker.seed(face106(), 1000, 1010);
    const result = tracker.push(texturedFaceFrame(160, 1, 0, .035, 1.025), 1033)!;
    expect(result).not.toBeNull(); expect(Math.atan2(result.b, result.a)).toBeCloseTo(.035, 1);
    expect(Math.hypot(result.a, result.b)).toBeCloseTo(1.025, 1);
    const center = { x: result.a * 80 - result.b * 80 + result.tx, y: result.b * 80 + result.a * 80 + result.ty };
    expect(center.x).toBeCloseTo(81, 0); expect(center.y).toBeCloseTo(80, 0);
    tracker.dispose();
  });
  it("rejects textureless propagation, occlusion, missing history and stale native results", () => {
    const tracker = new FaceMotionTracker(); tracker.push(faceFrame(160), 1000);
    expect(tracker.seed(face106(), 1000, 1010)).not.toBeNull();
    expect(tracker.push(faceFrame(160), 1033)).toBeNull();
    tracker.push(texturedFaceFrame(), 1100); expect(tracker.seed(face106(), 1100, 1100)).not.toBeNull();
    expect(tracker.push(faceFrame(160, [0, 0, 0]), 1133)).toBeNull();
    expect(tracker.seed(face106(), 900, 1133)).toBeNull();
    expect(tracker.seed(face106(), 1100, 2200)).toBeNull(); tracker.dispose();
  });
  it("expires without fresh detections even if frame tracking keeps succeeding", () => {
    const tracker = new FaceMotionTracker(); tracker.push(texturedFaceFrame(), 1000); tracker.seed(face106(), 1000, 1010);
    for (let i = 1; i <= 27; i++) expect(tracker.push(texturedFaceFrame(), 1000 + i * 33)).not.toBeNull();
    expect(tracker.push(texturedFaceFrame(), 1924)).toBeNull(); tracker.dispose();
  });
  it("drops masks after a long frame gap and clears all private history on disposal", () => {
    const tracker = new FaceMotionTracker(); const original = texturedFaceFrame(), before = original.data.slice();
    tracker.push(original, 1000); tracker.seed(face106(), 1000, 1010);
    expect(tracker.push(original, 1300)).toBeNull();
    const held = (tracker as unknown as {history:{data:Uint8Array}[]}).history.map(frame => frame.data);
    tracker.dispose(); expect(held.every(data => data.every(v => v === 0))).toBe(true);
    expect(original.data).toEqual(before); expect(tracker.seed(face106(), 1300, 1300)).toBeNull();
  });
});
