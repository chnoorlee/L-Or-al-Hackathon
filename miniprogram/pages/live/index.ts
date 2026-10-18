import type { NormalizedCircle, PixelBuffer } from "../../core/types";
import { DEFAULT_RENDER, resizeForPreview, type RenderOptions } from "../../tryon/engine";
import { RegionTracker } from "../../tryon/tracker";
import { canvasPoint, clearCanvas, drawPixels, withSampleMarkers, type PreviewCanvas } from "../../tryon/canvas";
import { LiveRenderer, type GLCanvas } from "../../tryon/live-renderer";
import { FaceDetector, type FaceDetection } from "../../tryon/face-detector";
import { buildFaceLayer, DEFAULT_FACE_LOOK, type FaceLook } from "../../tryon/face-makeup";
import { fitLivePreview } from "../../tryon/live-layout";
import { FaceMotionTracker, FACE_FRAME_GAP, FACE_REDETECT_AGE } from "../../tryon/face-motion";

type Phase = "off" | "view" | "sampleA" | "sampleB" | "review" | "live" | "lost";
interface LiveData extends RenderOptions {
  phase: Phase; cameraEnabled: boolean; cameraPending: boolean; devicePosition: "back" | "front";
  canvasHeight: number; canvasWidth: number; hasFrame: boolean; status: string; error: string; privacyVisible: boolean;
  coverMarker: string; referenceMarker: string; renderMs: number; cameraGeneration: number;
  gpu: boolean; holdingOriginal: boolean; shade: string; fineTune: boolean;
  trackingMode: "face" | "region"; category: "foundation" | "lipstick" | "blush";
  look: FaceLook; lipShade: string; blushShade: string;
}
interface Runtime {
  visible: boolean; generation: number; canvas: PreviewCanvas | null; width: number; windowHeight: number;
  listener: WechatMiniprogram.CameraFrameListener | null;
  frame: (PixelBuffer & { data: Uint8ClampedArray }) | null;
  tracker: RegionTracker | null; cover: NormalizedCircle | null; reference: NormalizedCircle | null;
  lastFrameAt: number; lastInteraction: number; watchdog?: ReturnType<typeof setTimeout>;
  idleTimer?: ReturnType<typeof setInterval>;
  renderer: LiveRenderer | null; lastAnalysisAt: number; lastStatsAt: number;
  detector: FaceDetector | null; faceValid: boolean; faceDeadline?: ReturnType<typeof setTimeout>;
  faceMotion: FaceMotionTracker; lastDetectionAt: number;
}
const runtimes = new WeakMap<object, Runtime>();
type ControlEvent = WechatMiniprogram.CustomEvent<{ value: number }, object, { key?: string; value?: string }>;
const MARKER_RADIUS = .045;
const LIP_COLORS = { rose: { r: 155, g: 57, b: 80 }, nude: { r: 164, g: 99, b: 91 }, berry: { r: 117, g: 41, b: 75 }, coral: { r: 204, g: 82, b: 72 }, red: { r: 167, g: 35, b: 47 } };
const BLUSH_COLORS = { rose: { r: 202, g: 107, b: 118 }, peach: { r: 217, g: 131, b: 102 }, mauve: { r: 169, g: 105, b: 135 } };

Page<LiveData, WechatMiniprogram.Page.CustomOption>({
  data: {
    ...DEFAULT_RENDER, mode: "effect", outline: false, phase: "off", cameraEnabled: false, cameraPending: false,
    devicePosition: "front", canvasHeight: 320, canvasWidth: 0, hasFrame: false, status: "开启镜头，让脸部自然入镜，即可叠加妆效。",
    error: "", privacyVisible: false, coverMarker: "", referenceMarker: "", renderMs: 0, cameraGeneration: 0,
    gpu: false, holdingOriginal: false, shade: "match", fineTune: false,
    trackingMode: "face", category: "foundation", look: { ...DEFAULT_FACE_LOOK }, lipShade: "rose", blushShade: "rose",
  },
  onLoad() {
    const runtime: Runtime = { visible: true, generation: 0, canvas: null, width: 0, windowHeight: 0, listener: null,
      frame: null, tracker: null, cover: null, reference: null, lastFrameAt: 0, lastInteraction: Date.now(),
      renderer: null, lastAnalysisAt: 0, lastStatsAt: 0, detector: null, faceValid: false,
      faceMotion: new FaceMotionTracker(), lastDetectionAt: 0 };
    runtimes.set(this, runtime);
    runtime.idleTimer = setInterval(() => {
      if (Date.now() - runtime.lastInteraction >= 300_000 && this.data.cameraEnabled) {
        this.stopCamera(); this.setData({ status: "长时间未操作，相机已关闭并清除本次画面。" });
      }
    }, 15_000);
  },
  onReady() { this.measureCanvas(); },
  onShow() { const runtime = runtimes.get(this); if (runtime) runtime.visible = true; },
  onHide() { const runtime = runtimes.get(this); if (runtime) runtime.visible = false; this.stopCamera(); },
  onUnload() { this.stopCamera(); const runtime = runtimes.get(this); runtime?.renderer?.dispose(); clearInterval(runtime?.idleTimer); runtimes.delete(this); },
  onResize() { this.stopCamera(); this.measureCanvas(); this.setData({ status: "画面尺寸已变化，请重新开启相机校准。" }); },
  measureCanvas() {
    const runtime = runtimes.get(this);
    if (!runtime) return;
    this.createSelectorQuery().select("#liveCanvas").fields({ node: true, size: true }).exec((items: { node?: PreviewCanvas; width?: number }[]) => {
      if (runtimes.get(this) !== runtime) return;
      if (!items[0]?.node || !items[0].width) { this.setData({ error: "当前环境无法初始化试妆画布。" }); return; }
      const window = typeof wx.getWindowInfo === "function" ? wx.getWindowInfo() : null;
      runtime.canvas = items[0].node;
      runtime.width = Math.min(600, window?.windowWidth || items[0].width);
      runtime.windowHeight = window?.windowHeight || Math.max(480, runtime.width * 2);
    });
    this.createSelectorQuery().select("#liveGLCanvas").fields({ node: true }).exec((items: { node?: GLCanvas }[]) => {
      if (runtimes.get(this) !== runtime || !items[0]?.node) return;
      runtime.renderer?.dispose(); runtime.renderer = null;
      try { runtime.renderer = new LiveRenderer(items[0].node); this.setData({ gpu: true }); }
      catch { this.setData({ gpu: false }); } // Canvas 2D remains available on devices without WebGL.
    });
  },
  onEnableCamera() {
    const runtime = runtimes.get(this);
    if (!runtime?.visible || this.data.cameraEnabled || this.data.cameraPending) return;
    const generation = ++runtime.generation;
    const active = () => runtimes.get(this) === runtime && runtime.visible && runtime.generation === generation;
    this.startAuthorizationWatchdog(runtime, generation);
    if (typeof wx.getPrivacySetting === "function") {
      wx.getPrivacySetting({ success: result => {
        if (!active()) return;
        clearTimeout(runtime.watchdog);
        if (result.needAuthorization) this.setData({ privacyVisible: true, cameraPending: false, status: "请确认隐私说明后开启相机。" }); else this.authorizeCamera();
      }, fail: () => {
        if (active()) { this.stopCamera(); this.setData({ error: "暂时无法确认隐私授权状态，请重试。" }); }
      } });
    } else this.authorizeCamera();
  },
  onAgreePrivacy() { this.setData({ privacyVisible: false }); this.authorizeCamera(); },
  onCancelPrivacy() { this.setData({ privacyVisible: false }); },
  authorizeCamera() {
    const runtime = runtimes.get(this);
    if (!runtime?.visible) return;
    const generation = ++runtime.generation;
    this.startAuthorizationWatchdog(runtime, generation);
    wx.authorize({ scope: "scope.camera", success: () => {
      if (runtimes.get(this) !== runtime || !runtime.visible || runtime.generation !== generation) return;
      clearTimeout(runtime.watchdog);
      runtime.lastInteraction = Date.now();
      this.setData({ cameraEnabled: true, cameraPending: false, cameraGeneration: generation, phase: "view", error: "", status: "正在等待相机画面…" });
      this.startWatchdog(runtime, generation);
    }, fail: () => {
      if (runtimes.get(this) === runtime && runtime.generation === generation) { this.stopCamera(); this.setData({ error: "未获得相机权限，请在微信设置中允许使用相机后重试。" }); }
    } });
  },
  startAuthorizationWatchdog(runtime: Runtime, generation: number) {
    clearTimeout(runtime.watchdog);
    this.setData({ cameraPending: true, error: "", status: "正在请求相机权限，请留意微信的授权提示。" });
    runtime.watchdog = setTimeout(() => {
      if (runtimes.get(this) === runtime && runtime.visible && runtime.generation === generation) {
        this.stopCamera();
        this.setData({ error: "相机授权未返回，请重试。若开发者工具没有弹窗，请在微信手机端预览，并检查相机权限。" });
      }
    }, 10000);
  },
  startWatchdog(runtime: Runtime, generation: number) {
    clearTimeout(runtime.watchdog);
    runtime.watchdog = setTimeout(() => {
      if (runtimes.get(this) === runtime && runtime.generation === generation && !runtime.frame) {
        this.stopCamera(); this.setData({ error: "没有收到实时帧。请在支持相机帧接口的微信真机上打开，并检查权限。" });
      }
    }, 8000);
  },
  onCameraReady(event?: WechatMiniprogram.CustomEvent) {
    const runtime = runtimes.get(this);
    if (!runtime?.visible || !this.data.cameraEnabled || runtime.listener || (event && Number(event.currentTarget.dataset.generation) !== runtime.generation)) return;
    const generation = runtime.generation;
    try {
      const context = wx.createCameraContext();
      if (typeof context.onCameraFrame !== "function") throw new Error("Frame API unavailable");
      if (this.data.trackingMode === "face") this.startFaceTracking(runtime, generation);
      runtime.listener = context.onCameraFrame(frame => {
        if (runtimes.get(this) !== runtime || !runtime.visible || runtime.generation !== generation || !this.data.cameraEnabled) return;
        const now = Date.now();
        if (now - runtime.lastFrameAt < (runtime.renderer ? 33 : 66) || ["sampleA", "sampleB", "review"].includes(this.data.phase)) return;
        runtime.lastFrameAt = now;
        try {
          const source = { width: frame.width, height: frame.height, data: new Uint8ClampedArray(frame.data) };
          // Camera-sized RGB stays on the GPU; only the small analysis image is retained.
          runtime.renderer?.upload(source);
          const analyze = !runtime.frame || now - runtime.lastAnalysisAt >= 66;
          if (analyze) {
            runtime.frame?.data.fill(0);
            runtime.frame = resizeForPreview(source, 256); runtime.lastAnalysisAt = now;
          }
          const image = runtime.frame!;
          clearTimeout(runtime.watchdog);
          runtime.watchdog = setTimeout(() => {
            if (runtimes.get(this) === runtime && runtime.generation === generation && ["view", "live", "lost"].includes(this.data.phase)) {
              this.stopCamera(); this.setData({ error: "相机画面已中断，已清除预览。请重新开启相机。" });
            }
          }, 3000);
          if (!runtime.canvas) throw new Error("Canvas unavailable");
          const size = fitLivePreview(source.width, source.height, runtime.width, runtime.windowHeight, this.data.trackingMode === "face");
          if (size.height !== this.data.canvasHeight || size.width !== this.data.canvasWidth || !this.data.hasFrame) {
            this.setData({ canvasHeight: size.height, canvasWidth: size.width, hasFrame: true });
          }
          if (this.data.trackingMode === "face") {
            const transform = runtime.faceMotion.push(source, now);
            if (runtime.faceValid) {
              if (transform) {
                runtime.renderer?.setFaceTransform(transform);
                this.armFaceDeadline(runtime, generation);
              } else this.withdrawFace(runtime, "正在重新定位 · 镜头保持实时");
            }
            this.paint();
            if (!runtime.lastDetectionAt || now - runtime.lastDetectionAt >= 100) {
              if (runtime.detector?.submit(source, now)) runtime.lastDetectionAt = now;
            }
            return;
          }
          if (analyze && ["live", "lost"].includes(this.data.phase) && runtime.tracker) {
            const result = runtime.tracker.process(image);
            const layer = result.status === "tracking" ? runtime.tracker.layer() : null;
            runtime.renderer?.setLayer(layer); layer?.distances.fill(0);
            if (result.status === "lost") {
              if (this.data.phase !== "lost") this.setData({ phase: "lost", status: "暂时丢失选区，妆效已撤去。回到刚才的位置可尝试恢复。" });
              if (runtime.tracker.expired) {
                runtime.tracker.dispose(); runtime.tracker = null;
                this.setData({ status: "未能找回选区，请重新圈选。" });
              }
            } else if (this.data.phase !== "live") this.setData({ phase: "live", status: "已找回选区，继续实时试妆。" });
          }
          this.paint();
          if (this.data.phase === "view" && !this.data.status.startsWith("让待")) this.setData({ status: "让待遮盖部位与周边皮肤同时入镜，再圈选试妆区域。" });
          if (now - runtime.lastStatsAt > 1000) { runtime.lastStatsAt = now; this.setData({ renderMs: Date.now() - now }); }
        } catch { this.stopCamera(); this.setData({ error: "实时画面处理失败，已清除画面。请重新开启相机。" }); }
      });
      runtime.listener.start({ fail: () => {
        if (runtimes.get(this) === runtime && runtime.generation === generation) { this.stopCamera(); this.setData({ error: "无法读取相机帧，请在微信真机上检查权限后重试。" }); }
      } });
    } catch { this.stopCamera(); this.setData({ error: "当前环境不支持相机逐帧处理，请用微信真机打开。" }); }
  },
  startFaceTracking(runtime: Runtime, generation: number) {
    if (!runtime.renderer) { this.setData({ error: "这台设备暂不支持自动跟脸渲染，可以切换局部遮瑕。", status: "自动跟脸暂不可用" }); return; }
    runtime.detector?.dispose(); clearTimeout(runtime.faceDeadline); runtime.faceMotion.dispose(); runtime.lastDetectionAt = 0;
    runtime.faceValid = false; runtime.renderer.setFaceLayer(null);
    const active = () => runtimes.get(this) === runtime && runtime.visible && runtime.generation === generation && runtime.detector === detector && this.data.trackingMode === "face";
    const detector = new FaceDetector((result: FaceDetection) => {
      if (!active()) return;
      clearTimeout(runtime.faceDeadline);
      const stale = Date.now() - result.capturedAt > FACE_REDETECT_AGE;
      let layer = stale ? null : buildFaceLayer(result.frame, result.anchors);
      const transform = layer ? runtime.faceMotion.seed(result.anchors[0], result.capturedAt, Date.now()) : null;
      if (!transform) { layer?.masks.fill(0); layer = null; runtime.faceMotion.reset(); }
      try {
        runtime.renderer!.setFaceLayer(layer);
        if (transform) runtime.renderer!.setFaceTransform(transform);
      } finally { layer?.masks.fill(0); }
      runtime.faceValid = !!layer;
      const phase = layer ? "live" : "view";
      const status = layer ? "已跟随面部 · 皮肤叠色避开眼周、唇部与鼻部" : stale ? "正在更新定位 · 镜头保持实时" : result.anchors.length > 1 ? "请让画面中只保留一张脸，妆效已撤去。" : result.anchors.length === 0 ? "请面向镜头，让脸部完整入镜" : "正在重新定位 · 镜头保持实时";
      if (this.data.phase !== phase || this.data.status !== status) this.setData({ phase, status, ...(!layer ? { holdingOriginal: false } : {}) });
      this.paint();
      if (layer) this.armFaceDeadline(runtime, generation);
      if (Date.now() - runtime.lastStatsAt > 1000) { runtime.lastStatsAt = Date.now(); this.setData({ renderMs: Date.now() - result.capturedAt }); }
    }, (error: string) => {
      if (!active()) return;
      clearTimeout(runtime.faceDeadline); runtime.faceMotion.reset(); runtime.faceValid = false; runtime.renderer?.setFaceLayer(null);
      this.setData({ phase: "view", holdingOriginal: false, error, status: "妆效尚未显示 · 人脸跟踪需要重试" }); this.paint();
    });
    runtime.detector = detector;
    this.setData({ phase: "view", error: "", status: "正在准备自动跟脸，首次定位请稍候…" });
    detector.start();
  },
  withdrawFace(runtime: Runtime, status: string) {
    clearTimeout(runtime.faceDeadline); runtime.faceMotion.reset(); runtime.faceValid = false;
    runtime.renderer?.setFaceLayer(null);
    if (this.data.phase !== "view" || this.data.status !== status || this.data.holdingOriginal) this.setData({ phase: "view", status, holdingOriginal: false });
  },
  armFaceDeadline(runtime: Runtime, generation: number) {
    clearTimeout(runtime.faceDeadline);
    runtime.faceDeadline = setTimeout(() => {
      if (runtimes.get(this) !== runtime || !runtime.visible || runtime.generation !== generation) return;
      this.withdrawFace(runtime, "正在等待新画面 · 妆效暂时撤去"); this.paint();
    }, Math.max(0, FACE_FRAME_GAP - (Date.now() - runtime.lastFrameAt)));
  },
  onRetryFace() {
    const runtime = runtimes.get(this);
    if (!runtime?.visible || !this.data.cameraEnabled || this.data.trackingMode !== "face" || !this.data.error || !runtime.renderer || !runtime.listener || !this.onInteraction()) return;
    this.startFaceTracking(runtime, runtime.generation);
    this.paint();
  },
  onTrackingMode(event: ControlEvent) {
    const trackingMode = event.currentTarget.dataset.value;
    if ((trackingMode !== "face" && trackingMode !== "region") || trackingMode === this.data.trackingMode || !this.onInteraction()) return;
    const restart = this.data.cameraEnabled;
    this.stopCamera();
    this.setData({ trackingMode, error: "", fineTune: false, devicePosition: trackingMode === "face" ? "front" : "back",
      status: trackingMode === "face" ? "让脸部自然入镜，直接探索叠加妆效。" : "开启相机后，定格圈选 A 待遮盖处、B 周边肤色。" }, () => { if (restart) this.onEnableCamera(); });
  },
  onCategory(event: ControlEvent) {
    const category = event.currentTarget.dataset.value;
    if ((category === "foundation" || category === "lipstick" || category === "blush") && this.onInteraction()) this.setData({ category });
  },
  onLayerToggle() {
    if (!this.onInteraction()) return;
    const key = this.data.category;
    this.setData({ look: { ...this.data.look, [key]: !this.data.look[key] } }); this.paint();
  },
  onColor(event: ControlEvent) {
    const value = event.currentTarget.dataset.value, category = this.data.category;
    if (!value || !this.onInteraction()) return;
    if (category === "lipstick" && Object.prototype.hasOwnProperty.call(LIP_COLORS, value)) this.setData({ lipShade: value, look: { ...this.data.look, lipstick: true, lipColor: LIP_COLORS[value as keyof typeof LIP_COLORS] } });
    else if (category === "blush" && Object.prototype.hasOwnProperty.call(BLUSH_COLORS, value)) this.setData({ blushShade: value, look: { ...this.data.look, blush: true, blushColor: BLUSH_COLORS[value as keyof typeof BLUSH_COLORS] } });
    this.paint();
  },
  onLookStrength(event: ControlEvent) {
    const value = Number(event.detail.value);
    if (!Number.isFinite(value) || !this.onInteraction()) return;
    const category = this.data.category;
    if (category === "foundation") return;
    this.setData({ look: { ...this.data.look, [category === "lipstick" ? "lipStrength" : "blushStrength"]: Math.max(0, Math.min(100, value)), [category]: true } }); this.paint();
  },
  onLipFinish(event: ControlEvent) {
    const value = event.currentTarget.dataset.value;
    if ((value === "satin" || value === "velvet") && this.onInteraction()) { this.setData({ look: { ...this.data.look, lipFinish: value } }); this.paint(); }
  },
  onCameraError(event: WechatMiniprogram.CustomEvent) {
    if (Number(event.currentTarget.dataset.generation) !== runtimes.get(this)?.generation) return;
    this.stopCamera(); this.setData({ error: "相机启动失败，请检查相机权限和设备占用情况。" });
  },
  onCameraStopped(event: WechatMiniprogram.CustomEvent) {
    if (Number(event.currentTarget.dataset.generation) === runtimes.get(this)?.generation) this.stopCamera();
  },
  stopCamera() {
    const runtime = runtimes.get(this);
    if (!runtime) return;
    runtime.generation++; clearTimeout(runtime.watchdog); clearTimeout(runtime.faceDeadline);
    runtime.detector?.dispose(); runtime.detector = null; runtime.faceValid = false;
    runtime.faceMotion.dispose(); runtime.lastDetectionAt = 0;
    const listener = runtime.listener; runtime.listener = null;
    try { listener?.stop(); } catch { /* Resources below are still cleared if the native listener has already stopped. */ }
    runtime.frame?.data.fill(0); runtime.frame = null; runtime.tracker?.dispose(); runtime.tracker = null;
    runtime.cover = null; runtime.reference = null; clearCanvas(runtime.canvas); runtime.renderer?.clear();
    runtime.lastFrameAt = 0; runtime.lastAnalysisAt = 0;
    this.setData({ cameraEnabled: false, cameraPending: false, hasFrame: false, phase: "off", coverMarker: "", referenceMarker: "", privacyVisible: false,
      canvasWidth: 0, canvasHeight: 320, holdingOriginal: false, status: "相机已关闭，本次画面与选区已清除。" });
  },
  onFreeze() {
    const runtime = runtimes.get(this);
    if (!runtime?.frame || !runtime.visible || !this.data.cameraEnabled || this.data.trackingMode !== "region") return;
    runtime.lastInteraction = Date.now(); runtime.tracker?.dispose(); runtime.tracker = null; runtime.cover = null; runtime.reference = null;
    runtime.renderer?.setLayer(null);
    this.setData({ phase: "sampleA", holdingOriginal: false, coverMarker: "", referenceMarker: "", error: "", status: "画面已定格：点选 A 待遮盖处。" });
    this.paint();
  },
  onSample(event: WechatMiniprogram.TouchCanvas) {
    const runtime = runtimes.get(this);
    if (!runtime?.frame || !runtime.canvas || !runtime.visible || !["sampleA", "sampleB"].includes(this.data.phase)) return;
    const point = canvasPoint(event, this.data.canvasWidth || runtime.width, this.data.canvasHeight);
    if (!point) return;
    runtime.lastInteraction = Date.now();
    const short = Math.min(runtime.frame.width, runtime.frame.height);
    const circle = { x: Math.max(MARKER_RADIUS * short / runtime.frame.width, Math.min(1 - MARKER_RADIUS * short / runtime.frame.width, point.x)),
      y: Math.max(MARKER_RADIUS * short / runtime.frame.height, Math.min(1 - MARKER_RADIUS * short / runtime.frame.height, point.y)), radius: MARKER_RADIUS };
    const marker = `left:${circle.x * 100}%;top:${circle.y * 100}%;`;
    if (this.data.phase === "sampleA") {
      runtime.cover = circle; this.setData({ phase: "sampleB", coverMarker: marker, status: "A 已用莓红圈标记。再点选 B 周边肤色，避开反光与阴影。" }); this.paint(); return;
    }
    runtime.reference = circle;
    try {
      runtime.tracker = new RegionTracker(runtime.frame, runtime.cover!, circle);
      const layer = runtime.tracker.layer(); runtime.renderer?.setLayer(layer); layer?.distances.fill(0);
      this.setData({ phase: "review", referenceMarker: marker, status: "检查金色轮廓是否正确。确认后会恢复实时画面并跟踪选区。", error: "" });
      this.paint();
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : "无法建立选区，请重新取样。" }); }
  },
  onStartTracking() {
    const runtime = runtimes.get(this);
    if (!runtime?.tracker || !runtime.visible || this.data.phase !== "review") return;
    runtime.lastInteraction = Date.now();
    this.startWatchdogForResume(runtime);
    this.setData({ phase: "live", coverMarker: "", referenceMarker: "", status: "实时试妆中 · 请缓慢移动，保持光线和距离稳定。" });
    this.paint();
  },
  onResumeView() {
    const runtime = runtimes.get(this);
    if (!runtime?.visible || !this.data.cameraEnabled) return;
    runtime.lastInteraction = Date.now(); runtime.tracker?.dispose(); runtime.tracker = null;
    this.startWatchdogForResume(runtime);
    runtime.renderer?.setLayer(null);
    this.setData({ phase: "view", error: "", coverMarker: "", referenceMarker: "", holdingOriginal: false });
    this.paint();
  },
  startWatchdogForResume(runtime: Runtime) {
    const generation = runtime.generation;
    clearTimeout(runtime.watchdog);
    runtime.watchdog = setTimeout(() => {
      if (runtimes.get(this) === runtime && runtime.generation === generation && ["view", "live", "lost"].includes(this.data.phase)) {
        this.stopCamera(); this.setData({ error: "未能恢复实时画面，请重新开启相机。" });
      }
    }, 3000);
  },
  onControl(event: ControlEvent) {
    const runtime = runtimes.get(this);
    if (!runtime?.visible) return;
    runtime.lastInteraction = Date.now();
    const key = event.currentTarget.dataset.key ?? "", value = Number(event.detail.value);
    const bounds: Record<string, [number, number]> = { strength: [0, 100], warmth: [-30, 30], brightness: [-30, 30], split: [0, 100] };
    if (!bounds[key] || !Number.isFinite(value)) return;
    this.setData({ [key]: Math.max(bounds[key][0], Math.min(bounds[key][1], value)) });
    if (key === "warmth" || key === "brightness") this.setData({ shade: "custom" });
    this.paint();
  },
  onFormula(event: ControlEvent) {
    const runtime = runtimes.get(this), formula = event.currentTarget.dataset.value;
    if (runtime?.visible && (formula === "sheer" || formula === "concealer" || formula === "soft")) { runtime.lastInteraction = Date.now(); this.setData({ formula }); this.paint(); }
  },
  onInteraction() {
    const runtime = runtimes.get(this);
    if (!runtime?.visible) return false;
    runtime.lastInteraction = Date.now(); return true;
  },
  onOriginal(event: WechatMiniprogram.SwitchChange) { if (this.onInteraction()) { this.setData({ mode: event.detail.value ? "original" : "effect" }); this.paint(); } },
  onCompare() { if (this.onInteraction()) { this.setData({ mode: this.data.mode === "split" ? "effect" : "split", holdingOriginal: false }); this.paint(); } },
  onHoldOriginal() { if (this.onInteraction()) { this.setData({ holdingOriginal: true }); this.paint(); } },
  onReleaseOriginal() { if (this.onInteraction()) { this.setData({ holdingOriginal: false }); this.paint(); } },
  onSplitMove(event: WechatMiniprogram.TouchCanvas) {
    const runtime = runtimes.get(this);
    if (!runtime?.visible || this.data.mode !== "split" || this.data.phase !== "live") return;
    const point = canvasPoint(event, this.data.canvasWidth || runtime.width, this.data.canvasHeight);
    if (point) { this.onInteraction(); this.setData({ split: Math.round(point.x * 100) }); this.paint(); }
  },
  onShade(event: ControlEvent) {
    const shade = event.currentTarget.dataset.value;
    const tones: Record<string, { warmth: number; brightness: number }> = { match: { warmth: 0, brightness: 0 }, cool: { warmth: -12, brightness: 0 }, warm: { warmth: 12, brightness: 0 }, lighter: { warmth: 0, brightness: 10 }, deeper: { warmth: 0, brightness: -10 } };
    if (shade && tones[shade] && this.onInteraction()) { this.setData({ ...tones[shade], shade }); this.paint(); }
  },
  onFineTune() { if (this.onInteraction()) this.setData({ fineTune: !this.data.fineTune }); },
  paint() {
    const runtime = runtimes.get(this);
    if (!runtime?.visible || !runtime.frame || !runtime.canvas) return;
    const options = this.data.phase === "review" ? { ...this.data, strength: 0, outline: true, mode: "effect" as const } :
      { ...this.data, mode: this.data.holdingOriginal || !["live", "review"].includes(this.data.phase) ? "original" as const : this.data.mode };
    const markers = ["sampleA", "sampleB", "review"].includes(this.data.phase) ?
      [runtime.cover, runtime.reference].filter((circle): circle is NormalizedCircle => circle !== null) : [];
    if (runtime.renderer) runtime.renderer.draw(options, markers, this.data.look);
    else {
      const pixels = runtime.tracker && ["live", "review"].includes(this.data.phase) ? runtime.tracker.preview(options) : runtime.frame.data;
      drawPixels(runtime.canvas, withSampleMarkers(pixels, runtime.frame.width, runtime.frame.height, markers), runtime.frame.width, runtime.frame.height);
    }
  },
  onFlip() {
    this.stopCamera();
    const runtime = runtimes.get(this), generation = runtime?.generation;
    // Wait for removal of the previous native camera before creating its replacement.
    this.setData({ devicePosition: this.data.devicePosition === "back" ? "front" : "back" }, () => {
      if (runtime?.visible && runtimes.get(this) === runtime && runtime.generation === generation) this.onEnableCamera();
    });
  },
  onSettings() { wx.openSetting({}); },
  onBack() { this.stopCamera(); wx.navigateBack({ fail: () => wx.reLaunch({ url: "/pages/entry/index" }) }); },
});
