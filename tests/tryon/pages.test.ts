import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appSessionRuntime, appSessionStore } from "../../miniprogram/session";
import { runLocalAnalysis } from "../../miniprogram/pages/shared/local-analysis";

type Definition = Record<string, unknown> & { data: Record<string, unknown> };
type Harness = Definition & { setData(data: Record<string, unknown>, callback?: () => void): void };
let studio: Definition, live: Definition;
let frameCallback: (frame: { width: number; height: number; data: ArrayBuffer }) => void;
let authorizeSuccess: (() => void) | undefined;
const stop = vi.fn(), draw = vi.fn(), clear = vi.fn();
const pages: Harness[] = [];
function image(dx = 0, visible = true) {
  const width = 100, height = 80, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(
    visible && Math.hypot(x + .5 - 32 - dx, y + .5 - 40) < 12 ? [227, 198, 181, 255] : [158, 111, 86, 255], (y * width + x) * 4);
  return { width, height, data };
}
async function invoke(page: Harness, name: string, ...args: unknown[]) {
  return (page[name] as (...values: unknown[]) => unknown).apply(page, args);
}
function mount(definition: Definition, deferredCanvas = false) {
  const canvas = { width: 100, height: 80, getContext: () => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: draw, clearRect: clear }) };
  let deliver: (() => void) | undefined;
  const page: Harness = { ...definition, data: structuredClone(definition.data), setData(data, callback) { Object.assign(this.data, data); callback?.(); },
    createSelectorQuery() {
      const query = { select: () => query, fields: () => query,
        exec(callback: (items: unknown[]) => void) { deliver = () => callback([{ node: canvas, width: 100 }]); if (!deferredCanvas) deliver(); } };
      return query;
    } };
  pages.push(page); void invoke(page, "onLoad");
  return { page, deliver: () => deliver?.() };
}
beforeAll(async () => {
  vi.stubGlobal("Page", (definition: Definition) => { studio = definition; }); await import("../../miniprogram/pages/studio/index");
  vi.stubGlobal("Page", (definition: Definition) => { live = definition; }); await import("../../miniprogram/pages/live/index");
});
beforeEach(async () => {
  vi.useFakeTimers(); stop.mockReset(); draw.mockReset(); clear.mockReset(); authorizeSuccess = undefined;
  vi.stubGlobal("wx", {
    authorize: vi.fn((options: { success(): void }) => { authorizeSuccess = options.success; }),
    createCameraContext: () => ({ onCameraFrame(callback: typeof frameCallback) { frameCallback = callback; return { start() {}, stop }; } }),
    navigateBack: vi.fn(), reLaunch: vi.fn(), navigateTo: vi.fn(), openSetting: vi.fn(),
  });
  await appSessionStore.restart();
});
afterEach(async () => { for (const page of pages.splice(0)) await invoke(page, "onUnload"); await appSessionStore.restart(); vi.useRealTimers(); });
afterAll(() => vi.unstubAllGlobals());

async function preparePhoto() {
  const identity = await appSessionRuntime.selectImage({ tempFilePath: "wxfile://synthetic.png", width: 100, height: 80, size: 32000, orientation: "up", format: "png" });
  const plan = appSessionStore.getSnapshot().image!.analysisPlan;
  appSessionRuntime.materializeImage(identity, { ...image(), plan, sourceImageVersion: identity.imageVersion }, "wxfile://synthetic.png");
  appSessionStore.setSample(appSessionStore.getImageIdentity()!, { coverCircle: { x: .32, y: .5, radius: .1 }, referenceCircle: { x: .7, y: .5, radius: .1 }, confirmed: true, revision: 1 }, true);
  const analysis = runLocalAnalysis(appSessionStore.getImageIdentity()!);
  await vi.runAllTimersAsync();
  expect((await analysis).kind).toBe("completed");
}
async function startCamera(page: Harness) {
  await invoke(page, "onTrackingMode", { currentTarget: { dataset: { value: "region" } } });
  await invoke(page, "onReady"); await invoke(page, "onEnableCamera"); authorizeSuccess!(); await invoke(page, "onCameraReady");
  emitFrame(); expect(page.data.hasFrame).toBe(true);
}
function emitFrame(dx = 0, visible = true) { const frame = image(dx, visible); frameCallback({ ...frame, data: frame.data.buffer }); }
const tap = (x: number) => ({ touches: [], changedTouches: [{ x, y: 40, identifier: 1 }] });

describe("photo studio actual page handlers", () => {
  it("opens an auto region, confirms it, changes makeup and restores an erased region", async () => {
    await preparePhoto(); const { page } = mount(studio); await invoke(page, "onReady"); await vi.advanceTimersByTimeAsync(30);
    expect(page.data.ready).toBe(true); expect(page.data.selectedPixels).toBeGreaterThan(400);
    await invoke(page, "onConfirmRegion"); expect(page.data.panel).toBe("makeup");
    await invoke(page, "onControl", { currentTarget: { dataset: { key: "strength" } }, detail: { value: 35 } });
    await vi.advanceTimersByTimeAsync(30); expect(page.data.strength).toBe(35); expect(draw).toHaveBeenCalled();
    await invoke(page, "onEditRegion"); const size = page.data.selectedPixels;
    await invoke(page, "onClear"); expect(page.data.selectedPixels).toBe(0);
    await invoke(page, "onConfirmRegion"); expect(page.data.panel).toBe("region");
    await invoke(page, "onUndo"); expect(page.data.selectedPixels).toBe(size);
  });
  it("clears canvas and cancels pending rendering when the session ends", async () => {
    await preparePhoto(); const { page } = mount(studio); await invoke(page, "onReady");
    await appSessionStore.restart(); await vi.advanceTimersByTimeAsync(50);
    expect(page.data.cleared).toBe(true); expect(page.data.selectedPixels).toBe(0); expect(clear).toHaveBeenCalled(); expect(draw).not.toHaveBeenCalled();
  });
  it("rejects a late canvas result after unload", async () => {
    await preparePhoto(); const { page, deliver } = mount(studio, true); await invoke(page, "onReady");
    await invoke(page, "onUnload"); deliver(); await vi.advanceTimersByTimeAsync(30); expect(draw).not.toHaveBeenCalled();
  });
  it("redraws after hide and show, including when initialization finishes in the background", async () => {
    await preparePhoto(); const { page } = mount(studio); await invoke(page, "onReady");
    await invoke(page, "onHide"); await vi.advanceTimersByTimeAsync(30); expect(draw).not.toHaveBeenCalled();
    await invoke(page, "onShow"); await vi.advanceTimersByTimeAsync(30); expect(draw).toHaveBeenCalled();
    draw.mockClear();
    const early = mount(studio).page;
    const initialization = invoke(early, "onReady");
    await invoke(early, "onHide"); await initialization; await vi.advanceTimersByTimeAsync(30);
    expect(early.data.ready).toBe(false); expect(draw).not.toHaveBeenCalled();
    await invoke(early, "onShow"); await vi.advanceTimersByTimeAsync(30);
    expect(early.data.ready).toBe(true); expect(draw).toHaveBeenCalled();
  });
  it("recomputes the region on tolerance change and lets undo restore a manual selection", async () => {
    await preparePhoto(); const { page } = mount(studio); await invoke(page, "onReady");
    const size = page.data.selectedPixels; await invoke(page, "onClear");
    await invoke(page, "onControl", { currentTarget: { dataset: { key: "tolerance" } }, detail: { value: 20 } });
    expect(page.data.selectedPixels).toBe(size);
    await invoke(page, "onUndo"); expect(page.data.selectedPixels).toBe(0);
  });
  it("clears the source session even when the finish navigation fails", async () => {
    await preparePhoto(); const { page } = mount(studio); await invoke(page, "onReady");
    vi.mocked(wx.reLaunch).mockImplementationOnce(options => { options.fail?.({ errMsg: "navigation failed" }); });
    await invoke(page, "onFinish"); await vi.advanceTimersByTimeAsync(30);
    expect(appSessionStore.getSnapshot()).toMatchObject({ image: null, sample: null, result: null });
    expect(page.data.cleared).toBe(true); expect(page.data.error).toContain("图片已清除"); expect(draw).not.toHaveBeenCalled();
    await invoke(page, "onFinish"); expect(wx.reLaunch).toHaveBeenCalledTimes(2);
  });
});

describe("live camera actual page handlers with simulated WeChat frames", () => {
  it("times out a silent camera authorization, ignores its late reply and permits retry", async () => {
    const { page } = mount(live); await invoke(page, "onEnableCamera");
    const staleSuccess = authorizeSuccess!;
    expect(page.data.cameraPending).toBe(true);
    await invoke(page, "onEnableCamera"); expect(wx.authorize).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10001);
    expect(page.data.cameraPending).toBe(false); expect(page.data.error).toContain("授权未返回");
    staleSuccess(); expect(page.data.cameraEnabled).toBe(false);
    await invoke(page, "onEnableCamera"); authorizeSuccess!();
    expect(page.data.cameraEnabled).toBe(true); expect(page.data.cameraPending).toBe(false);
  });
  it("times out a silent privacy check and ignores its late reply", async () => {
    let resolvePrivacy: ((value: { needAuthorization: boolean }) => void) | undefined;
    Object.assign(wx, { getPrivacySetting: (options: { success: typeof resolvePrivacy }) => { resolvePrivacy = options.success; } });
    const { page } = mount(live); await invoke(page, "onEnableCamera");
    await vi.advanceTimersByTimeAsync(10001);
    resolvePrivacy!({ needAuthorization: false });
    expect(wx.authorize).not.toHaveBeenCalled(); expect(page.data.cameraPending).toBe(false);
    expect(page.data.cameraEnabled).toBe(false); expect(page.data.error).toContain("授权未返回");
  });
  it("lets the user read privacy consent without an authorization timeout", async () => {
    Object.assign(wx, { getPrivacySetting: (options: { success(value: { needAuthorization: boolean }): void }) => options.success({ needAuthorization: true }) });
    const { page } = mount(live); await invoke(page, "onEnableCamera");
    expect(page.data.privacyVisible).toBe(true); expect(page.data.cameraPending).toBe(false);
    await vi.advanceTimersByTimeAsync(11000); expect(page.data.error).toBe("");
    await invoke(page, "onAgreePrivacy"); authorizeSuccess!();
    expect(page.data.cameraEnabled).toBe(true);
  });
  it("requires user confirmation then renders motion, withdrawing the effect after loss", async () => {
    const { page } = mount(live); await startCamera(page); await invoke(page, "onFreeze");
    await invoke(page, "onSample", tap(32)); expect(page.data.phase).toBe("sampleB");
    await invoke(page, "onSample", tap(70)); expect(page.data.phase).toBe("review");
    await invoke(page, "onStartTracking"); await vi.advanceTimersByTimeAsync(170); emitFrame(3);
    expect(page.data.phase).toBe("live"); await vi.advanceTimersByTimeAsync(170); emitFrame(0, false);
    expect(page.data.phase).toBe("lost"); expect(draw.mock.calls[draw.mock.calls.length - 1]?.[0].data).toEqual(image(0, false).data);
  });
  it("stops camera and drops late frames on hide; return requires an explicit restart", async () => {
    const { page } = mount(live); await startCamera(page); await invoke(page, "onHide");
    const calls = draw.mock.calls.length; await vi.advanceTimersByTimeAsync(200); emitFrame();
    expect(stop).toHaveBeenCalledTimes(1); expect(page.data.hasFrame).toBe(false); expect(draw).toHaveBeenCalledTimes(calls);
    await invoke(page, "onShow"); expect(page.data.cameraEnabled).toBe(false);
  });
  it("changes makeup and compares immediately without receiving another camera frame", async () => {
    const { page } = mount(live); await startCamera(page); await invoke(page, "onFreeze");
    await invoke(page, "onSample", tap(32)); await invoke(page, "onSample", tap(70)); await invoke(page, "onStartTracking");
    draw.mockClear();
    await invoke(page, "onControl", { currentTarget: { dataset: { key: "strength" } }, detail: { value: 0 } });
    expect(draw).toHaveBeenCalledTimes(1); expect(draw.mock.lastCall![0].data).toEqual(image().data);
    await invoke(page, "onControl", { currentTarget: { dataset: { key: "strength" } }, detail: { value: 90 } });
    expect(draw.mock.lastCall![0].data).not.toEqual(image().data);
    await invoke(page, "onCompare"); expect(page.data.mode).toBe("split");
    await invoke(page, "onHoldOriginal"); expect(draw.mock.lastCall![0].data).toEqual(image().data);
    await invoke(page, "onReleaseOriginal"); expect(page.data.mode).toBe("split"); expect(page.data.holdingOriginal).toBe(false);
    await invoke(page, "onShade", { currentTarget: { dataset: { value: "warm" } } }); expect(page.data.warmth).toBe(12);
    await invoke(page, "onHide"); expect(page.data.holdingOriginal).toBe(false);
  });
  it("does not open camera from a permission callback received after leaving", async () => {
    const { page } = mount(live); await invoke(page, "onEnableCamera"); await invoke(page, "onHide"); authorizeSuccess!(); expect(page.data.cameraEnabled).toBe(false);
  });
  it("ignores old frames and stop events after switching to a new camera", async () => {
    const { page } = mount(live); await startCamera(page);
    const oldGeneration = page.data.cameraGeneration, oldFrameCallback = frameCallback;
    await invoke(page, "onFlip"); expect(page.data.cameraEnabled).toBe(false); expect(page.data.devicePosition).toBe("front");
    authorizeSuccess!(); await invoke(page, "onCameraReady");
    const calls = draw.mock.calls.length; await vi.advanceTimersByTimeAsync(200);
    oldFrameCallback({ ...image(), data: image().data.buffer });
    await invoke(page, "onCameraStopped", { currentTarget: { dataset: { generation: oldGeneration } } });
    expect(page.data.cameraEnabled).toBe(true); expect(draw).toHaveBeenCalledTimes(calls);
    emitFrame(); expect(page.data.hasFrame).toBe(true);
    await invoke(page, "onCameraError", { currentTarget: { dataset: { generation: page.data.cameraGeneration } } });
    expect(page.data.cameraEnabled).toBe(false); expect(page.data.error).toContain("相机启动失败");
  });
  it("clears stale live preview when frames stop arriving", async () => {
    const { page } = mount(live); await startCamera(page); await vi.advanceTimersByTimeAsync(3001);
    expect(page.data.cameraEnabled).toBe(false); expect(page.data.error).toContain("中断"); expect(clear).toHaveBeenCalled();
  });
  it("reports unsupported/no-frame devices, and clears frozen calibration after inactivity", async () => {
    const first = mount(live).page; await invoke(first, "onEnableCamera"); authorizeSuccess!(); await vi.advanceTimersByTimeAsync(8001);
    expect(first.data.error).toContain("没有收到实时帧");
    const second = mount(live).page; await startCamera(second); await invoke(second, "onFreeze"); await vi.advanceTimersByTimeAsync(315000);
    expect(second.data.hasFrame).toBe(false); expect(second.data.status).toContain("长时间");
  });
});
