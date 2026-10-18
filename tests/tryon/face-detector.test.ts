import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FaceDetector } from "../../miniprogram/tryon/face-detector";
import { face106, faceFrame } from "../fixtures/face106";

let events: Record<string, (anchors: unknown[]) => void>, ready: (error: number | null) => void;
const result = (anchors: unknown[]) => events.updateAnchors(anchors);
const destroy=vi.fn(), off=vi.fn(), detectFace=vi.fn();
let detector: FaceDetector;
beforeEach(() => {
  vi.useFakeTimers(); destroy.mockReset(); off.mockReset(); detectFace.mockReset(); events={};
  vi.stubGlobal("wx", { createVKSession: vi.fn(() => ({on(event: string,callback: typeof result){events[event]=callback;},start(callback:typeof ready){ready=callback;},detectFace,destroy,off})) });
});
afterEach(() => {detector?.dispose();vi.useRealTimers();vi.unstubAllGlobals();});
describe("manual face detector ownership and asynchronous lifecycle", () => {
  it("keeps one request in flight, pairs its frame, and clears private copies after use", () => {
    let held: Uint8ClampedArray | undefined;
    const received=vi.fn(({frame,capturedAt})=>{held=frame.data;expect(frame.width).toBe(256);expect(frame.data[0]).toBe(158);expect(capturedAt).toBe(123);});
    detector=new FaceDetector(received,vi.fn());detector.start();
    const frame=faceFrame(800);expect(detector.submit(frame,123)).toBe(false);ready(null);
    expect(detector.submit(frame,123)).toBe(true);expect(detector.submit(frame,456)).toBe(false);
    const options=detectFace.mock.calls[0][0]; expect(options).toMatchObject({width:256,height:256,modelMode:1,sourceType:0});
    frame.data.fill(99);result([face106()]);expect(received).toHaveBeenCalledTimes(1);
    expect(held!.every(v=>v===0)).toBe(true);expect(new Uint8Array(options.frameBuffer).every(v=>v===0)).toBe(true);
    expect(frame.data[0]).toBe(99);
  });
  it("destroys a stalled session instead of pairing a late result with a newer frame", async () => {
    const received=vi.fn(),error=vi.fn();detector=new FaceDetector(received,error);detector.start();ready(null);
    detector.submit(faceFrame(),-10);result([]);received.mockClear();
    detector.submit(faceFrame(),0);await vi.advanceTimersByTimeAsync(1201);
    expect(error).toHaveBeenCalledOnce();expect(destroy).toHaveBeenCalledOnce();
    expect(detector.submit(faceFrame(),1300)).toBe(false);result([face106()]);expect(received).not.toHaveBeenCalled();
    expect(new Uint8Array(detectFace.mock.calls[0][0].frameBuffer).every(v=>v===0)).toBe(true);
  });
  it("ignores startup/results after disposal and clears the startup deadline", async () => {
    const received=vi.fn(),error=vi.fn();detector=new FaceDetector(received,error);detector.start();detector.dispose();
    ready(null);result([face106()]);await vi.advanceTimersByTimeAsync(9000);
    expect(destroy).toHaveBeenCalledOnce();expect(error).not.toHaveBeenCalled();expect(received).not.toHaveBeenCalled();
  });
  it("surfaces unsupported sessions, silent startup and rendering errors", async () => {
    const error=vi.fn();detector=new FaceDetector(vi.fn(),error);detector.start();ready(2000004);expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0]).toContain("2000004");
    detector=new FaceDetector(vi.fn(),error);detector.start();await vi.advanceTimersByTimeAsync(8001);expect(error).toHaveBeenCalledTimes(2);
    detector=new FaceDetector(()=>{throw new Error('lost GL');},error);detector.start();ready(null);detector.submit(faceFrame(),0);
    expect(()=>result([face106()])).not.toThrow();expect(error).toHaveBeenCalledTimes(3);
  });
  it("delivers empty results so the caller can withdraw makeup", () => {
    const received=vi.fn();detector=new FaceDetector(received,vi.fn());detector.start();ready(null);detector.submit(faceFrame(),0);result([]);
    expect(received.mock.calls[0][0].anchors).toEqual([]);
  });
  it("handles the first add event, subsequent updates, and removal without painting removed anchors", () => {
    const received=vi.fn();detector=new FaceDetector(received,vi.fn());detector.start();ready(null);
    detector.submit(faceFrame(),10);events.addAnchors([face106()]);result([face106()]);
    expect(received).toHaveBeenCalledTimes(1);expect(received.mock.calls[0][0].anchors).toHaveLength(1);
    detector.submit(faceFrame(),20);result([face106()]);expect(received).toHaveBeenCalledTimes(2);
    detector.submit(faceFrame(),30);events.removeAnchors([face106()]);expect(received.mock.calls[2][0].anchors).toEqual([]);
    detector.dispose();expect(off.mock.calls.map(call=>call[0])).toEqual(["addAnchors","updateAnchors","removeAnchors"]);
  });
  it("allows the first inference to warm up but releases buffers if it never returns", async () => {
    const received=vi.fn(),error=vi.fn();detector=new FaceDetector(received,error);detector.start();ready(null);
    detector.submit(faceFrame(),0);await vi.advanceTimersByTimeAsync(1500);expect(error).not.toHaveBeenCalled();
    events.addAnchors([face106()]);expect(received).toHaveBeenCalledOnce();
    detector.dispose();detector=new FaceDetector(received,error);detector.start();ready(null);detector.submit(faceFrame(),0);
    await vi.advanceTimersByTimeAsync(8001);expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0]).toContain("首次定位");
    expect(new Uint8Array(detectFace.mock.lastCall![0].frameBuffer).every(v=>v===0)).toBe(true);
  });
  it.each([112,2000001,2003000,2003001])("preserves native startup code %s instead of misreporting every failure as unsupported", code => {
    const error=vi.fn();detector=new FaceDetector(vi.fn(),error);detector.start();ready(code);
    expect(error.mock.calls[0][0]).toContain(String(code));expect(error.mock.calls[0][0]).not.toContain("设备不支持");
  });
});
