import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appSessionRuntime, appSessionStore } from "../../miniprogram/session";
import { runLocalAnalysis } from "../../miniprogram/pages/shared/local-analysis";
import { presentRecommendation, resultMarkerStyle } from "../../miniprogram/pages/shared/result-presentation";

// Exercise actual Page handlers and the real session/analysis engine. Only WeChat's
// view bridge and navigation are simulated; this is not a native rendering test.
interface PageDefinition extends Record<string, unknown> {
  data: Record<string, unknown>;
}
interface HarnessPage extends PageDefinition {
  setData(values: Record<string, unknown>): void;
}
let sampleDefinition: PageDefinition;
let resultDefinition: PageDefinition;
const pages: HarnessPage[] = [];
const reLaunch = vi.fn();
const navigateTo = vi.fn();

beforeAll(async () => {
  vi.stubGlobal("Page", (definition: PageDefinition) => { sampleDefinition = definition; });
  await import("../../miniprogram/pages/sample/index");
  vi.stubGlobal("Page", (definition: PageDefinition) => { resultDefinition = definition; });
  await import("../../miniprogram/pages/result/index");
});

beforeEach(async () => {
  reLaunch.mockReset();
  navigateTo.mockReset();
  vi.stubGlobal("wx", {
    reLaunch, navigateTo, redirectTo: vi.fn(),
    showModal: vi.fn((options: { success(): void }) => options.success()),
  });
  await appSessionStore.restart();
});

afterEach(async () => {
  for (const page of pages.splice(0)) await invoke(page, "onUnload");
  vi.restoreAllMocks();
  await appSessionStore.restart();
});
afterAll(() => vi.unstubAllGlobals());

async function invoke(page: HarnessPage, method: string, ...args: unknown[]) {
  const handler = page[method];
  if (typeof handler !== "function") throw new Error(`Missing page method ${method}`);
  return await handler.apply(page, args);
}

async function mount(definition: PageDefinition): Promise<HarnessPage> {
  const page: HarnessPage = {
    ...definition,
    data: structuredClone(definition.data),
    setData(values) { Object.assign(this.data, values); },
    createSelectorQuery() {
      let onRect = (_rect: object) => {};
      const query = {
        select() { return query; },
        boundingClientRect(callback: (rect: object) => void) { onRect = callback; return query; },
        exec() { onRect({ left: 0, top: 0, width: 100, height: 100 }); },
      };
      return query;
    },
  };
  pages.push(page);
  await invoke(page, "onLoad");
  await vi.waitFor(() => expect(page.data.imagePath).toBe("wxfile://synthetic-analysis.png"));
  if (definition === sampleDefinition) await invoke(page, "measureStage");
  return page;
}

async function selectSyntheticImage(clipped = false) {
  const identity = await appSessionRuntime.selectImage({
    tempFilePath: "wxfile://synthetic-source.png", size: 40_000,
    width: 100, height: 100, orientation: "up", format: "png",
  });
  const plan = appSessionStore.getSnapshot().image!.analysisPlan;
  const data = new Uint8ClampedArray(100 * 100 * 4);
  for (let i = 0; i < data.length; i += 4) {
    const left = (i / 4) % 100 < 50;
    data.set(clipped ? [255, 255, 255, 255] : left ? [170, 110, 90, 255] : [210, 160, 130, 255], i);
  }
  expect(appSessionRuntime.materializeImage(identity, {
    width: 100, height: 100, data, plan, sourceImageVersion: identity.imageVersion,
  }, "wxfile://synthetic-analysis.png")).toBe(true);
  return identity;
}

async function tap(page: HarnessPage, x: number, y = 50) {
  const previousRevision = appSessionStore.getSnapshot().revision;
  await invoke(page, "onImageTap", { changedTouches: [{ clientX: x, clientY: y }], touches: [] });
  await vi.waitFor(() => expect(appSessionStore.getSnapshot().revision).toBeGreaterThan(previousRevision));
}

async function samplePair(page: HarnessPage) {
  await tap(page, 25);
  await tap(page, 75);
  expect(appSessionStore.getSnapshot().sampleConfirmed).toBe(true);
}

describe("guided sampling and reversible correction", () => {
  it("guides A to B, keeps deliberate A selection, and undoes one edit only", async () => {
    await selectSyntheticImage();
    const page = await mount(sampleDefinition);
    expect(page.data.fineTuneExpanded).toBe(false);
    expect(page.data.activeMarker).toBe("cover");
    await tap(page, 25);
    expect(page.data.activeMarker).toBe("reference");
    await invoke(page, "onSelectMarker", { currentTarget: { dataset: { marker: "cover" } } });
    expect(page.data.promptText).toContain("当前调整 A");
    await tap(page, 30);
    expect(appSessionStore.getSnapshot().sample?.referenceCircle).toBeNull();
    await invoke(page, "onUndoSample");
    expect(appSessionStore.getSnapshot().sample?.coverCircle?.x).toBe(0.25);
    expect(page.data.activeMarker).toBe("cover");
    expect(page.data.canUndo).toBe(false);
    const revision = appSessionStore.getSnapshot().revision;
    await invoke(page, "onUndoSample");
    expect(appSessionStore.getSnapshot().revision).toBe(revision);
  });

  it("undoes an initial placement and restores the incomplete state", async () => {
    await selectSyntheticImage();
    const page = await mount(sampleDefinition);
    await tap(page, 25);
    await invoke(page, "onUndoSample");
    expect(page.data.hasCover).toBe(false);
    expect(page.data.canAnalyze).toBe(false);
    expect(page.data.coverColor).toBe("");
    expect(page.data.activeMarker).toBe("cover");
    await samplePair(page);
    await invoke(page, "onUndoSample");
    expect(page.data.hasCover).toBe(true);
    expect(page.data.hasReference).toBe(false);
    expect(appSessionStore.getSnapshot().sampleConfirmed).toBe(false);
  });

  it("supports button-only placement and invalidates old analysis after adjust/undo", async () => {
    await selectSyntheticImage();
    const page = await mount(sampleDefinition);
    await invoke(page, "onToggleFineTune");
    expect(page.data.fineTuneExpanded).toBe(true);
    await invoke(page, "onCenterMarker");
    await invoke(page, "onCenterMarker");
    expect(page.data.canAnalyze).toBe(false); // Both centered: overlap is blocked.
    for (let i = 0; i < 8; i++) {
      await invoke(page, "onNudgeMarker", { currentTarget: { dataset: { direction: "right" } } });
    }
    expect(page.data.canAnalyze).toBe(true);
    const analysis = await runLocalAnalysis(appSessionStore.getImageIdentity()!);
    expect(analysis.kind).toBe("completed");
    const oldRevision = appSessionStore.getSnapshot().revision;
    const oldCircle = appSessionStore.getSnapshot().sample?.referenceCircle;
    await invoke(page, "changeRadius", 0.015);
    expect(appSessionStore.getSnapshot().result).toBeNull();
    await invoke(page, "onUndoSample");
    expect(appSessionStore.getSnapshot().sample?.referenceCircle).toEqual(oldCircle);
    expect(appSessionStore.getSnapshot().result).toBeNull();
    expect(appSessionStore.getSnapshot().revision).toBeGreaterThan(oldRevision);
  });

  it("rejects a pending undo after a different image is selected", async () => {
    await selectSyntheticImage();
    const page = await mount(sampleDefinition);
    await tap(page, 25);
    const oldSnapshot = appSessionStore.getSnapshot();
    let release!: (value: typeof oldSnapshot) => void;
    vi.spyOn(appSessionStore, "access").mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const undo = invoke(page, "onUndoSample");
    const nextIdentity = await selectSyntheticImage();
    release(oldSnapshot);
    await undo;
    expect(appSessionStore.getImageIdentity()).toEqual(nextIdentity);
    expect(appSessionStore.getSnapshot().sample).toBeNull();
    expect(page.data.canUndo).toBe(false);
  });

  it("does not allow undo to revive an expired image", async () => {
    await selectSyntheticImage();
    const page = await mount(sampleDefinition);
    await tap(page, 25);
    const future = Date.now() + 300_001;
    vi.spyOn(Date, "now").mockReturnValue(future);
    await invoke(page, "onUndoSample");
    expect(appSessionStore.getSnapshot().image).toBeNull();
    expect(page.data.imagePath).toBe("");
    expect(page.data.coverColor).toBe("");
    expect(page.data.canUndo).toBe(false);
  });
});

describe("honest results and explicit finish", () => {
  it("opens photo try-on after sampling, including reuse after a navigation failure", async () => {
    await selectSyntheticImage(); const page = await mount(sampleDefinition); await samplePair(page);
    navigateTo.mockImplementationOnce((options: { fail(): void }) => options.fail());
    await invoke(page, "onTryOn");
    expect(navigateTo).toHaveBeenCalledWith(expect.objectContaining({ url: "/pages/studio/index" }));
    expect(page.data.navigationBusy).toBe(false);
    const result = appSessionStore.getSnapshot().result;
    await invoke(page, "onTryOn");
    expect(navigateTo).toHaveBeenCalledTimes(2); expect(appSessionStore.getSnapshot().result).toBe(result);
  });
  async function resultFlow(clipped = false) {
    await selectSyntheticImage(clipped);
    const sample = await mount(sampleDefinition);
    await samplePair(sample);
    await invoke(sample, "onAnalyze");
    expect(appSessionStore.getSnapshot().error).toBeNull();
    expect(appSessionStore.getSnapshot().phase).toBe("RESULT");
    expect(navigateTo).toHaveBeenCalledWith(expect.objectContaining({ url: "/pages/result/index" }));
    return { sample, result: await mount(resultDefinition) };
  }

  it("explains the empty catalog and displays the actual sample locations", async () => {
    const { result } = await resultFlow();
    expect(result.data.resultTitle).toBe("本次取样");
    expect(result.data.emptyTitle).toBe("商品色号尚未接入");
    expect(result.data.coverColor).toBe("#aa6e5a");
    expect(result.data.referenceColor).toBe("#d2a082");
    expect(result.data.coverMarkerStyle).toContain("left:25%");
    expect(result.data.referenceMarkerStyle).toContain("left:75%");
    expect(result.data.showCommerceAction).toBe(false);
    expect(result.data.qualityText).toBe("");
    await invoke(result, "onToggleImage");
    expect(result.data.imageExpanded).toBe(true);
  });

  it("keeps measured exposure warnings on the result screen", async () => {
    const { result } = await resultFlow(true);
    expect(result.data.qualityText).toContain("A、B 区可能存在过曝或欠曝");
  });

  it("clears the session and both page views even when returning home fails", async () => {
    const { sample, result } = await resultFlow();
    reLaunch.mockImplementationOnce((options: { fail(): void }) => options.fail());
    await invoke(result, "onRestart");
    expect(appSessionStore.getSnapshot()).toMatchObject({ image: null, sample: null, result: null });
    expect(result.data).toMatchObject({ cleared: true, imagePath: "", coverColor: "", referenceColor: "", showCommerceAction: false, navigationBusy: false });
    expect(sample.data).toMatchObject({ imagePath: "", coverColor: "", referenceColor: "", coverCircle: null, referenceCircle: null, canUndo: false, layoutReady: false });
    expect(result.data.commerceError).toContain("无法返回开始页");
    await invoke(sample, "onUndoSample");
    expect(appSessionStore.getSnapshot().image).toBeNull();
    await invoke(result, "onRestart");
    expect(reLaunch).toHaveBeenCalledTimes(2);
  });

  it("distinguishes missing data, ineligible products and calibration limitations", async () => {
    await resultFlow();
    const recommendation = appSessionStore.getSnapshot().result!.recommendation;
    expect(presentRecommendation({ ...recommendation, reasonCodes: ["NO_ELIGIBLE_CATALOG_ENTRIES"] }).emptyTitle).toBe("暂没有适用于本次取样的商品");
    expect(presentRecommendation({ ...recommendation, reasonCodes: ["UNCALIBRATED_INPUT"] }).emptyTitle).toBe("这张照片暂不能对应到商品色号");
    expect(presentRecommendation({ ...recommendation, reasonCodes: ["NO_COMPARABLE_CATALOG_EVIDENCE"] }).emptyTitle).toBe("尚无可靠的色号参考");
  });

  it("does not restore a cleared photo from delayed page refreshes", async () => {
    const { sample, result } = await resultFlow();
    const previous = appSessionStore.getSnapshot();
    let release!: (snapshot: typeof previous) => void;
    const pending = new Promise<typeof previous>(resolve => { release = resolve; });
    vi.spyOn(appSessionStore, "access")
      .mockImplementationOnce(() => pending)
      .mockImplementationOnce(() => pending);
    const refreshResult = invoke(result, "onShow");
    const refreshSample = invoke(sample, "onShow");
    reLaunch.mockImplementationOnce((options: { fail(): void }) => options.fail());
    await invoke(result, "onRestart");
    release(previous);
    await Promise.all([refreshResult, refreshSample]);
    expect(result.data.imagePath).toBe("");
    expect(sample.data.coverColor).toBe("");
    expect(sample.data.coverCircle).toBeNull();
    expect(appSessionStore.getSnapshot().image).toBeNull();
  });

  it.each([{ width: 1200, height: 600 }, { width: 600, height: 1200 }])("keeps result overlays circular for %j", size => {
    const style = resultMarkerStyle({ x: 0.25, y: 0.75, radius: 0.1 }, size);
    const percentages = Object.fromEntries(style.split(";").map(property => {
      const [name, value] = property.split(":");
      return [name, parseFloat(value)];
    }));
    expect(percentages.width * size.width / 100).toBeCloseTo(120);
    expect(percentages.height * size.height / 100).toBeCloseTo(120);
    expect(percentages.left).toBe(25);
    expect(percentages.top).toBe(75);
  });
});
