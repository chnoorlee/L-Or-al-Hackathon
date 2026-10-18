import { appSessionStore } from "../../session/index";
import type { Point } from "../../core/types";
import { DEFAULT_RENDER, TryOnEngine, type RegionResult, type RenderOptions } from "../../tryon/engine";
import { canvasPoint, clearCanvas, drawPixels, parseHex, rgbHex, type PreviewCanvas } from "../../tryon/canvas";

interface StudioData extends RenderOptions {
  ready: boolean; cleared: boolean; panel: "region" | "makeup"; fineTune: boolean;
  tool: "add" | "paint" | "erase"; tolerance: number; brushSize: number;
  canvasHeight: number; selectedPixels: number; canUndo: boolean;
  notice: string; error: string; shadeHex: string; lastRenderMs: number;
}
interface Runtime {
  engine: TryOnEngine | null; canvas: PreviewCanvas | null; width: number;
  revision: number; sessionId: string | null; visible: boolean;
  timer?: ReturnType<typeof setTimeout>; unsubscribe?: () => void;
  previous: Point | null;
  navigating?: boolean;
}
const runtimes = new WeakMap<object, Runtime>();
type ControlEvent = WechatMiniprogram.CustomEvent<{ value: number }, object, { key?: string; value?: string }>;
const ranges: Record<string, [number, number]> = { strength: [0, 100], warmth: [-30, 30], brightness: [-30, 30], feather: [0, 16], split: [0, 100], tolerance: [5, 40], brushSize: [1, 12] };

Page<StudioData, WechatMiniprogram.Page.CustomOption>({
  data: {
    ...DEFAULT_RENDER, ready: false, cleared: false, panel: "region", tool: "add", fineTune: false,
    tolerance: 18, brushSize: 3, canvasHeight: 340, selectedPixels: 0, canUndo: false,
    notice: "正在根据 A、B 两处取样生成选区", error: "", shadeHex: "#ffffff", lastRenderMs: 0,
  },
  onLoad() {
    const state = appSessionStore.getSnapshot();
    const runtime: Runtime = { engine: null, canvas: null, width: 0, revision: state.revision,
      sessionId: state.sessionId, visible: true, previous: null };
    runtimes.set(this, runtime);
    runtime.unsubscribe = appSessionStore.subscribe(snapshot => {
      if (snapshot.sessionId !== runtime.sessionId || snapshot.revision !== runtime.revision || !snapshot.image) this.clearPreview();
    });
  },
  async onReady() {
    const runtime = runtimes.get(this);
    const state = await appSessionStore.access();
    if (!runtime || runtimes.get(this) !== runtime || this.data.cleared) return;
    const sample = state.sample, result = state.result;
    if (!state.image?.analysis || !sample?.coverCircle || !sample.referenceCircle ||
        !result?.colorSummary.cover.lab || !result.colorSummary.reference.lab || !state.sampleConfirmed) {
      this.clearPreview(); return;
    }
    try {
      runtime.engine = new TryOnEngine(state.image.analysis, sample.coverCircle, sample.referenceCircle,
        result.colorSummary.cover.lab, result.colorSummary.reference.lab, parseHex(result.previewColors.reference));
      const region = runtime.engine.segment(this.data.tolerance, undefined, false, false);
      this.updateRegion(region);
      this.measureCanvas();
    } catch { this.setData({ error: "无法准备试妆画面，请返回重新取样。" }); }
  },
  onShow() {
    const runtime = runtimes.get(this);
    if (runtime) {
      runtime.visible = true; runtime.navigating = false;
      if (runtime.engine) {
        if (runtime.canvas) this.scheduleRender(); else this.measureCanvas();
      }
    }
    void appSessionStore.expireIfNeeded();
  },
  onHide() {
    const runtime = runtimes.get(this);
    if (runtime) { runtime.visible = false; runtime.previous = null; clearTimeout(runtime.timer); runtime.timer = undefined; clearCanvas(runtime.canvas); }
  },
  onUnload() { this.clearPreview(); runtimes.get(this)?.unsubscribe?.(); runtimes.delete(this); },
  onResize() { this.measureCanvas(); },
  clearPreview() {
    const runtime = runtimes.get(this);
    if (!runtime) return;
    clearTimeout(runtime.timer); runtime.timer = undefined; clearCanvas(runtime.canvas); runtime.engine?.dispose(); runtime.engine = null; runtime.previous = null;
    this.setData({ ready: false, cleared: true, selectedPixels: 0, canUndo: false, shadeHex: "#ffffff", notice: "本次图片已清除，请重新选择。" });
  },
  usable(): Runtime | null {
    const runtime = runtimes.get(this);
    appSessionStore.touch();
    return runtime?.visible && runtime.engine && !this.data.cleared ? runtime : null;
  },
  measureCanvas() {
    const runtime = this.usable() as Runtime | null;
    if (!runtime) return;
    this.createSelectorQuery().select("#tryonCanvas").fields({ node: true, size: true }).exec((items: { node?: PreviewCanvas; width?: number }[]) => {
      if (runtimes.get(this) !== runtime || !runtime.engine || this.data.cleared) return;
      const item = items[0];
      if (!item?.node || !item.width) { this.setData({ error: "当前环境无法初始化画布，请使用新版微信重试。" }); return; }
      runtime.canvas = item.node; runtime.width = item.width;
      this.setData({ canvasHeight: item.width * runtime.engine.height / runtime.engine.width, ready: true });
      this.scheduleRender();
    });
  },
  scheduleRender() {
    const runtime = this.usable() as Runtime | null;
    if (!runtime?.canvas) return;
    if (runtime.timer !== undefined) return;
    runtime.timer = setTimeout(() => {
      runtime.timer = undefined;
      if (runtimes.get(this) !== runtime || !runtime.engine || !runtime.visible || !runtime.canvas) return;
      try {
        const start = Date.now();
        const options: RenderOptions = this.data.panel === "region"
          ? { ...this.data, strength: 0, outline: true, mode: "effect" } : this.data;
        drawPixels(runtime.canvas, runtime.engine.render(options), runtime.engine.width, runtime.engine.height);
        this.setData({ shadeHex: rgbHex(runtime.engine.shade(this.data.warmth, this.data.brightness)), lastRenderMs: Date.now() - start });
      } catch { this.setData({ error: "画面更新失败，请返回重新取样。" }); }
    }, 24);
  },
  updateRegion(region?: RegionResult) {
    const runtime = runtimes.get(this);
    if (!runtime?.engine) return;
    let notice = "金色轮廓内是将要试妆的区域，请确认并修正。";
    if (region?.reason === "similar_samples") notice = "两处颜色太接近，无法自动区分；请涂抹选区或返回重新取样。";
    else if (region?.reason === "no_region") notice = "此处没有找到与 A 相似的区域，可调整容差或用涂抹补选。";
    else if (region?.touchesEdge) notice = "选区到达画面边缘，请检查是否误选了背景，可用擦除修正。";
    this.setData({ selectedPixels: runtime.engine.selectedPixels, canUndo: runtime.engine.canUndo, notice });
    this.scheduleRender();
  },
  onFineTune() {
    if (this.usable() && this.data.panel === "makeup") this.setData({ fineTune: !this.data.fineTune });
  },
  onTool(event: ControlEvent) {
    const tool = event.currentTarget.dataset.value;
    if (this.usable() && (tool === "add" || tool === "paint" || tool === "erase")) this.setData({ tool });
  },
  onTouchStart(event: WechatMiniprogram.TouchCanvas) {
    const runtime = this.usable() as Runtime | null;
    if (!runtime?.engine || !this.data.ready || this.data.panel !== "region") return;
    const point = canvasPoint(event, runtime.width, this.data.canvasHeight);
    if (!point) return;
    if (this.data.tool === "add") { this.updateRegion(runtime.engine.segment(this.data.tolerance, point, true)); return; }
    runtime.engine.checkpoint(); runtime.previous = point;
    runtime.engine.brush(point, point, this.data.brushSize / 100, this.data.tool === "erase"); this.updateRegion();
  },
  onTouchMove(event: WechatMiniprogram.TouchCanvas) {
    const runtime = this.usable() as Runtime | null;
    if (!runtime?.engine || !runtime.previous || this.data.panel !== "region") return;
    const point = canvasPoint(event, runtime.width, this.data.canvasHeight);
    if (!point) return;
    runtime.engine.brush(runtime.previous, point, this.data.brushSize / 100, this.data.tool === "erase");
    runtime.previous = point; this.updateRegion();
  },
  onTouchEnd(event: WechatMiniprogram.TouchCanvas) { this.onTouchMove(event); const runtime = runtimes.get(this); if (runtime) runtime.previous = null; },
  onTouchCancel() { const runtime = runtimes.get(this); if (runtime) runtime.previous = null; },
  onAuto() { const runtime = this.usable() as Runtime | null; if (runtime?.engine) this.updateRegion(runtime.engine.segment(this.data.tolerance)); },
  onUndo() { const runtime = this.usable() as Runtime | null; if (runtime?.engine) { runtime.engine.undo(); this.updateRegion(); } },
  onClear() { const runtime = this.usable() as Runtime | null; if (runtime?.engine) { runtime.engine.clear(); this.updateRegion(); } },
  onConfirmRegion() {
    if (this.usable() && this.data.selectedPixels > 0) { this.setData({ panel: "makeup", outline: false, mode: "effect" }); this.scheduleRender(); }
  },
  onEditRegion() { if (this.usable()) { this.setData({ panel: "region" }); this.scheduleRender(); } },
  onControl(event: ControlEvent) {
    const runtime = this.usable() as Runtime | null;
    if (!runtime?.engine) return;
    const key = event.currentTarget.dataset.key ?? "";
    const range = ranges[key], value = Number(event.detail.value);
    if (!range || !Number.isFinite(value)) return;
    const next = Math.max(range[0], Math.min(range[1], value));
    this.setData({ [key]: next });
    if (key === "tolerance") this.updateRegion(runtime.engine.segment(next));
    else this.scheduleRender();
  },
  onChoice(event: ControlEvent) {
    if (!this.usable()) return;
    const { key, value } = event.currentTarget.dataset;
    if (key === "formula" && ["sheer", "concealer", "soft"].includes(value ?? "") || key === "mode" && ["effect", "split", "original"].includes(value ?? "")) {
      this.setData({ [key!]: value }); this.scheduleRender();
    }
  },
  onOutline(event: WechatMiniprogram.SwitchChange) { if (this.usable()) { this.setData({ outline: event.detail.value }); this.scheduleRender(); } },
  onResetMakeup() { if (this.usable()) { this.setData({ ...DEFAULT_RENDER, mode: "effect", outline: false }); this.scheduleRender(); } },
  async onFinish() {
    const runtime = runtimes.get(this);
    if (!runtime?.visible || runtime.navigating) return;
    runtime.navigating = true;
    this.clearPreview();
    await appSessionStore.restart();
    if (runtimes.get(this) !== runtime || !runtime.visible) return;
    wx.reLaunch({ url: "/pages/entry/index", fail: () => {
      if (runtimes.get(this) !== runtime) return;
      runtime.navigating = false;
      this.setData({ error: "本次图片已清除，但未能返回首页，请重试。" });
    } });
  },
  onBack() { wx.navigateBack({ fail: () => wx.reLaunch({ url: "/pages/entry/index" }) }); },
  onLive() {
    const runtime = this.usable() as Runtime | null;
    if (!runtime || runtime.navigating) return;
    runtime.navigating = true;
    wx.navigateTo({ url: "/pages/live/index", fail: () => {
      if (runtimes.get(this) !== runtime) return;
      runtime.navigating = false; this.setData({ error: "无法打开实时试妆，请重试。" });
    } });
  },
});
