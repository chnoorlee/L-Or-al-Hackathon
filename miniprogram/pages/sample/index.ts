import {
  createContainTransform,
  getCircleIssues,
  type ContainTransform,
  type NormalizedCircle,
} from "../../core/index";
import {
  appAnalysisCoordinator,
  appSessionStore,
  type AppSessionImage,
  type SamplePair,
  type SessionImageIdentity,
} from "../../session/index";
import { inspectSample, runLocalAnalysis } from "../shared/local-analysis";

type MarkerKey = "cover" | "reference";
type MoveDirection = "up" | "down" | "left" | "right";

interface SamplePageData {
  readonly fineTuneExpanded: boolean;
  readonly canUndo: boolean;
  readonly sessionId: string;
  readonly sessionRevision: number;
  readonly imageVersion: string;
  readonly imagePath: string;
  readonly layoutReady: boolean;
  readonly photoLayerStyle: string;
  readonly imageStyle: string;
  readonly zoom: number;
  readonly zoomText: string;
  readonly activeMarker: MarkerKey | "";
  readonly activeMarkerText: string;
  readonly canMoveActiveMarker: boolean;
  readonly coverCircle: NormalizedCircle | null;
  readonly referenceCircle: NormalizedCircle | null;
  readonly coverMarkerStyle: string;
  readonly referenceMarkerStyle: string;
  readonly hasCover: boolean;
  readonly hasReference: boolean;
  readonly cannotShrink: boolean;
  readonly cannotGrow: boolean;
  readonly coverColor: string;
  readonly referenceColor: string;
  readonly coverColorText: string;
  readonly referenceColorText: string;
  readonly coverSwatchStyle: string;
  readonly referenceSwatchStyle: string;
  readonly coverStateText: string;
  readonly referenceStateText: string;
  readonly promptText: string;
  readonly statusText: string;
  readonly canAnalyze: boolean;
  readonly isAnalyzing: boolean;
  readonly navigationBusy: boolean;
  readonly analysisStageText: string;
  readonly messageText: string;
  readonly messageKind: "inline-error" | "inline-warning" | "inline-info";
}

interface StageLayout {
  readonly width: number;
  readonly height: number;
  readonly imageTransform: ContainTransform;
  readonly image: NonNullable<AppSessionImage["analysis"]>;
}

interface ElementRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface MarkerDataset {
  readonly marker?: MarkerKey;
}

interface MoveDataset {
  readonly direction?: MoveDirection;
}

interface ScaleDetail {
  readonly scale?: number;
}

interface DragState {
  readonly identity: SessionImageIdentity;
  readonly request: number;
  readonly marker: MarkerKey;
  readonly startX: number;
  readonly startY: number;
  readonly original: NormalizedCircle;
  lastX: number;
  lastY: number;
  moved: boolean;
  ended: boolean;
  rectResolved: boolean;
  finalizing: boolean;
  imageRect: ElementRect | null;
}

interface PageRuntime {
  undoSample: {
    readonly identity: SessionImageIdentity;
    readonly coverCircle: NormalizedCircle | null;
    readonly referenceCircle: NormalizedCircle | null;
    readonly activeMarker: MarkerKey;
  } | null;
  alive: boolean;
  layoutRequest: number;
  navigationBusy: boolean;
  stageLayout: StageLayout | null;
  dragState: DragState | null;
  placementRequest: number;
  unsubscribe: (() => void) | null;
  initialized: boolean;
  returningToEntry: boolean;
}

const DEFAULT_RADIUS = 0.08;
const MIN_RADIUS = 0.035;
const MAX_RADIUS = 0.18;
const RADIUS_STEP = 0.015;
const POSITION_STEP = 0.025;

const pageRuntimes = new WeakMap<object, PageRuntime>();

Page<SamplePageData, WechatMiniprogram.Page.CustomOption>({
  data: {
    fineTuneExpanded: false,
    canUndo: false,
    sessionId: "",
    sessionRevision: -1,
    imageVersion: "",
    imagePath: "",
    layoutReady: false,
    photoLayerStyle: "",
    imageStyle: "",
    zoom: 1,
    zoomText: "100%",
    activeMarker: "",
    activeMarkerText: "尚未选择",
    canMoveActiveMarker: false,
    coverCircle: null,
    referenceCircle: null,
    coverMarkerStyle: "",
    referenceMarkerStyle: "",
    hasCover: false,
    hasReference: false,
    cannotShrink: true,
    cannotGrow: true,
    coverColor: "",
    referenceColor: "",
    coverColorText: "颜色未获取",
    referenceColorText: "颜色未获取",
    coverSwatchStyle: "",
    referenceSwatchStyle: "",
    coverStateText: "未选择",
    referenceStateText: "未选择",
    promptText: "先点待遮盖处，再点附近希望接近的肤色",
    statusText: "正在准备图片。请先选择 A 待遮盖处。",
    canAnalyze: false,
    isAnalyzing: false,
    navigationBusy: false,
    analysisStageText: "",
    messageText: "",
    messageKind: "inline-info",
  },

  onLoad() {
    const runtime: PageRuntime = {
      undoSample: null,
      alive: true,
      layoutRequest: 0,
      navigationBusy: false,
      stageLayout: null,
      dragState: null,
      placementRequest: 0,
      unsubscribe: null,
      initialized: false,
      returningToEntry: false,
    };
    pageRuntimes.set(this, runtime);
    runtime.unsubscribe = appSessionStore.subscribe((snapshot) => {
      if (!isPageRuntimeActive(this, runtime)) {
        return;
      }
      if (runtime.undoSample !== null && !matchesImageIdentity(snapshot, runtime.undoSample.identity)) {
        runtime.undoSample = null;
        this.setData({ canUndo: false });
      }
      if (snapshot.image === null) {
        runtime.stageLayout = null;
        runtime.dragState = null;
        runtime.layoutRequest += 1;
        runtime.placementRequest += 1;
        this.setData({
          sessionId: "", sessionRevision: -1, imageVersion: "", layoutReady: false,
          imagePath: "", coverCircle: null, referenceCircle: null,
          coverMarkerStyle: "", referenceMarkerStyle: "",
          coverColor: "", referenceColor: "", coverSwatchStyle: "", referenceSwatchStyle: "",
          coverColorText: "颜色未获取", referenceColorText: "颜色未获取",
          hasCover: false, hasReference: false, canAnalyze: false, canMoveActiveMarker: false,
          statusText: "本次图片与取样已清除，请重新选择图片。",
          promptText: "请重新选择图片", messageText: "",
        });
      }
      const stage = snapshot.analysis?.stage;
      const currentIdentity = imageIdentityFromPage(this.data);
      const nextIdentity = imageIdentityFromSnapshot(snapshot);
      const identityUpdate =
        currentIdentity !== null &&
        nextIdentity !== null &&
        currentIdentity.sessionId === nextIdentity.sessionId &&
        currentIdentity.imageVersion === nextIdentity.imageVersion
          ? { sessionRevision: nextIdentity.revision }
          : {};
      const analysisStageText = stage === undefined ? "" : stageCopy(stage);
      this.setData({
        ...identityUpdate,
        isAnalyzing: snapshot.phase === "ANALYZING",
        analysisStageText,
        ...(analysisStageText ? { statusText: analysisStageText } : {}),
      });
    });
    void this.initializePage();
  },

  onReady() {
    if (this.data.imagePath) {
      void this.measureStage();
    }
  },

  async onShow() {
    const runtime = pageRuntimes.get(this);
    if (
      runtime === undefined ||
      !isPageRuntimeActive(this, runtime) ||
      !runtime.initialized
    ) {
      return;
    }
    if (runtime.navigationBusy) {
      runtime.navigationBusy = false;
      this.setData({ navigationBusy: false });
    }
    const snapshot = await appSessionStore.access();
    if (!isPageRuntimeActive(this, runtime)) {
      return;
    }
    if (snapshot.image?.analysis === null || snapshot.image === null) {
      this.returnToEntry(snapshot.error?.message ?? "本次图片已清除，请重新选择。");
      return;
    }
    const identity = imageIdentityFromSnapshot(snapshot);
    if (identity === null) {
      this.returnToEntry("本次图片已清除，请重新选择。");
      return;
    }
    appSessionStore.touch();
    this.renderStoredSample(
      snapshot.image,
      snapshot.sample,
      undefined,
      identity,
    );
  },

  onHide() {
    this.invalidatePendingInteraction(false);
    appAnalysisCoordinator.cancel("hidden");
  },

  onUnload() {
    const runtime = pageRuntimes.get(this);
    if (runtime !== undefined) {
      runtime.alive = false;
      runtime.undoSample = null;
      runtime.layoutRequest += 1;
      runtime.unsubscribe?.();
      runtime.unsubscribe = null;
      runtime.dragState = null;
      runtime.placementRequest += 1;
      runtime.stageLayout = null;
      runtime.initialized = false;
      runtime.returningToEntry = false;
      pageRuntimes.delete(this);
    }
    appAnalysisCoordinator.cancel("hidden");
  },

  onResize() {
    this.invalidatePendingInteraction();
    if (this.data.imagePath) {
      void this.measureStage();
    }
  },

  async initializePage() {
    const runtime = pageRuntimes.get(this);
    if (runtime === undefined || !isPageRuntimeActive(this, runtime)) {
      return;
    }
    const snapshot = await appSessionStore.access();
    if (!isPageRuntimeActive(this, runtime)) {
      return;
    }
    const image = snapshot.image;
    if (image === null || image.analysis === null) {
      this.returnToEntry(snapshot.error?.message ?? "本次图片已清除，请重新选择。");
      return;
    }
    const identity = imageIdentityFromSnapshot(snapshot);
    if (identity === null) {
      this.returnToEntry("本次图片已清除，请重新选择。");
      return;
    }
    runtime.initialized = true;
    if (!matchesImageIdentity(appSessionStore.getSnapshot(), identity)) {
      return;
    }
    appSessionStore.touch();
    this.setData({ imagePath: image.previewRef });
    this.renderStoredSample(
      image,
      snapshot.sample,
      undefined,
      identity,
    );
    setTimeout(() => {
      if (isPageRuntimeActive(this, runtime)) {
        void this.measureStage();
      }
    }, 0);
  },

  measureStage(): Promise<void> {
    const runtime = pageRuntimes.get(this);
    const snapshot = appSessionStore.getSnapshot();
    const image = snapshot.image?.analysis;
    const identity = imageIdentityFromSnapshot(snapshot);
    if (
      runtime === undefined ||
      !isPageRuntimeActive(this, runtime) ||
      image === null ||
      image === undefined ||
      identity === null
    ) {
      return Promise.resolve();
    }
    const request = ++runtime.layoutRequest;
    return new Promise((resolve) => {
      this.createSelectorQuery()
        .select("#photoStage")
        .boundingClientRect((
          rect: WechatMiniprogram.BoundingClientRectCallbackResult | null | undefined,
        ) => {
          if (
            !isPageRuntimeActive(this, runtime) ||
            request !== runtime.layoutRequest ||
            !matchesImageGeneration(appSessionStore.getSnapshot(), identity)
          ) {
            resolve();
            return;
          }
          if (rect === null || rect === undefined || rect.width <= 0 || rect.height <= 0) {
            resolve();
            return;
          }
          const transform = createContainTransform(image, {
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
          runtime.stageLayout = {
            width: rect.width,
            height: rect.height,
            imageTransform: transform,
            image,
          };
          this.setData({
            layoutReady: true,
            photoLayerStyle: `width:${rect.width}px;height:${rect.height}px;`,
            imageStyle: imageStyle(transform),
            ...this.markerStyles(this.data.coverCircle, this.data.referenceCircle),
          });
          resolve();
        })
        .exec();
    });
  },

  onImageTap(event: WechatMiniprogram.TouchEvent) {
    if (this.data.isAnalyzing) {
      return;
    }
    const runtime = pageRuntimes.get(this);
    if (runtime === undefined || !isPageRuntimeActive(this, runtime)) {
      return;
    }
    const touch = event.changedTouches[0] ?? event.touches[0];
    if (touch === undefined) {
      return;
    }
    const marker: MarkerKey = this.data.activeMarker || (this.data.coverCircle === null
      ? "cover"
      : this.data.referenceCircle === null
        ? "reference"
        : "cover");
    const request = ++runtime.placementRequest;
    void this.placeMarkerAt(touch.clientX, touch.clientY, marker, request);
  },

  onStageInteraction() {
    this.invalidatePendingInteraction();
    void this.ensureActiveSession();
  },

  async placeMarkerAt(
    clientX: number,
    clientY: number,
    marker: MarkerKey,
    request: number,
  ) {
    const runtime = pageRuntimes.get(this);
    if (runtime === undefined || !isPageRuntimeActive(this, runtime)) {
      return;
    }
    const identity = imageIdentityFromPage(this.data);
    if (identity === null || !(await this.ensureActiveSession(identity))) {
      return;
    }
    if (
      !isPageRuntimeActive(this, runtime) ||
      request !== runtime.placementRequest
    ) {
      return;
    }
    const image = runtime.stageLayout?.image;
    if (image === undefined) {
      return;
    }
    const rect = await this.measureImageRect();
    if (
      !isPageRuntimeActive(this, runtime) ||
      request !== runtime.placementRequest ||
      rect === null ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      return;
    }
    const rawX = (clientX - rect.left) / rect.width;
    const rawY = (clientY - rect.top) / rect.height;
    if (rawX < 0 || rawX > 1 || rawY < 0 || rawY > 1) {
      return;
    }

    const snapshot = await appSessionStore.access();
    if (
      !isPageRuntimeActive(this, runtime) ||
      request !== runtime.placementRequest ||
      !matchesImageGeneration(snapshot, identity) ||
      snapshot.image === null ||
      snapshot.image.analysis === null
    ) {
      return;
    }
    const currentIdentity = imageIdentityFromSnapshot(snapshot);
    if (currentIdentity === null) {
      return;
    }
    appSessionStore.touch();
    const cover = snapshot.sample?.coverCircle ?? null;
    const reference = snapshot.sample?.referenceCircle ?? null;
    const existing = marker === "cover" ? cover : reference;
    const radius = existing?.radius ?? DEFAULT_RADIUS;
    const circle = clampCircle({ x: rawX, y: rawY, radius }, image);
    const coverCircle = marker === "cover" ? circle : cover;
    const referenceCircle = marker === "reference" ? circle : reference;
    await this.persistSample(
      coverCircle,
      referenceCircle,
      marker,
      currentIdentity,
      `${markerLabel(marker)}已放置，${positionText(circle)}。`,
      () =>
        isPageRuntimeActive(this, runtime) &&
        request === runtime.placementRequest,
    );
  },

  async onSelectMarker(
    event: WechatMiniprogram.BaseEvent<WechatMiniprogram.IAnyObject, MarkerDataset>,
  ) {
    this.invalidatePendingInteraction();
    const identity = imageIdentityFromPage(this.data);
    if (identity === null || !(await this.ensureActiveSession(identity))) {
      return;
    }
    const marker = event.currentTarget.dataset.marker;
    if (marker === "cover" || marker === "reference") {
      const circle = marker === "cover" ? this.data.coverCircle : this.data.referenceCircle;
      this.setData({
        activeMarker: marker,
        activeMarkerText: markerLabel(marker),
        canMoveActiveMarker: circle !== null,
        statusText: circle === null
          ? `已选择${markerLabel(marker)}。点击图片放置，或展开微调使用放置按钮。`
          : `已选择${markerLabel(marker)}。点击图片或拖动圆框调整，也可展开微调使用方向按钮。`,
        promptText: samplePrompt(this.data.coverCircle, this.data.referenceCircle, marker, this.data.canAnalyze),
        ...this.radiusLimits(marker, this.data.coverCircle, this.data.referenceCircle),
      });
    }
  },

  async onCenterMarker() {
    this.invalidatePendingInteraction();
    const runtime = pageRuntimes.get(this);
    if (runtime === undefined || !isPageRuntimeActive(this, runtime)) {
      return;
    }
    const identity = imageIdentityFromPage(this.data);
    if (identity === null || !(await this.ensureActiveSession(identity))) {
      return;
    }
    const marker = this.data.activeMarker;
    const image = runtime.stageLayout?.image;
    if (marker === "" || image === undefined) {
      return;
    }
    const current = marker === "cover" ? this.data.coverCircle : this.data.referenceCircle;
    const centered = clampCircle(
      { x: 0.5, y: 0.5, radius: current?.radius ?? DEFAULT_RADIUS },
      image,
    );
    await this.persistSample(
      marker === "cover" ? centered : this.data.coverCircle,
      marker === "reference" ? centered : this.data.referenceCircle,
      marker,
      identity,
      `${markerLabel(marker)}已放到图片中心。`,
    );
  },

  async onNudgeMarker(
    event: WechatMiniprogram.BaseEvent<WechatMiniprogram.IAnyObject, MoveDataset>,
  ) {
    const direction = event.currentTarget.dataset.direction;
    if (!isMoveDirection(direction)) {
      return;
    }
    this.invalidatePendingInteraction();
    const runtime = pageRuntimes.get(this);
    if (runtime === undefined || !isPageRuntimeActive(this, runtime)) {
      return;
    }
    const identity = imageIdentityFromPage(this.data);
    if (identity === null || !(await this.ensureActiveSession(identity))) {
      return;
    }
    const marker = this.data.activeMarker;
    const image = runtime.stageLayout?.image;
    const current = marker === "cover"
      ? this.data.coverCircle
      : marker === "reference"
        ? this.data.referenceCircle
        : null;
    if (marker === "" || image === undefined || current === null) {
      return;
    }
    const deltaX = direction === "left" ? -POSITION_STEP : direction === "right" ? POSITION_STEP : 0;
    const deltaY = direction === "up" ? -POSITION_STEP : direction === "down" ? POSITION_STEP : 0;
    const moved = clampCircle(
      { ...current, x: current.x + deltaX, y: current.y + deltaY },
      image,
    );
    await this.persistSample(
      marker === "cover" ? moved : this.data.coverCircle,
      marker === "reference" ? moved : this.data.referenceCircle,
      marker,
      identity,
      `${markerLabel(marker)}已${directionLabel(direction)}，${positionText(moved)}。`,
    );
  },

  async onMarkerTouchStart(
    event: WechatMiniprogram.TouchEvent<WechatMiniprogram.IAnyObject, WechatMiniprogram.IAnyObject, MarkerDataset>,
  ) {
    if (this.data.isAnalyzing) {
      return;
    }
    const runtime = pageRuntimes.get(this);
    if (runtime === undefined || !isPageRuntimeActive(this, runtime)) {
      return;
    }
    const marker = event.currentTarget.dataset.marker;
    const touch = event.touches[0] ?? event.changedTouches[0];
    const circle = marker === "cover" ? this.data.coverCircle : this.data.referenceCircle;
    if ((marker !== "cover" && marker !== "reference") || touch === undefined || circle === null) {
      return;
    }
    const identity = imageIdentityFromPage(this.data);
    if (identity === null) {
      return;
    }
    const request = this.invalidatePendingInteraction();
    const nextDrag: DragState = {
      identity,
      request,
      marker,
      startX: touch.clientX,
      startY: touch.clientY,
      original: circle,
      lastX: touch.clientX,
      lastY: touch.clientY,
      moved: false,
      ended: false,
      rectResolved: false,
      finalizing: false,
      imageRect: null,
    };
    runtime.dragState = nextDrag;
    this.setData({
      activeMarker: marker,
      activeMarkerText: markerLabel(marker),
      canMoveActiveMarker: true,
      promptText: samplePrompt(this.data.coverCircle, this.data.referenceCircle, marker, this.data.canAnalyze),
    });
    if (!(await this.ensureActiveSession(identity))) {
      if (runtime.dragState === nextDrag) {
        runtime.dragState = null;
      }
      return;
    }
    const rect = await this.measureImageRect();
    if (
      !isPageRuntimeActive(this, runtime) ||
      runtime.dragState !== nextDrag ||
      request !== runtime.placementRequest
    ) {
      return;
    }
    nextDrag.imageRect = rect;
    nextDrag.rectResolved = true;
    this.renderDragPreview(nextDrag);
    if (nextDrag.ended) {
      await this.finalizeDrag(nextDrag);
    }
  },

  onMarkerTouchMove(event: WechatMiniprogram.TouchEvent) {
    const runtime = pageRuntimes.get(this);
    if (runtime === undefined || !isPageRuntimeActive(this, runtime)) {
      return;
    }
    const drag = runtime.dragState;
    const touch = event.touches[0] ?? event.changedTouches[0];
    if (
      drag === null ||
      drag.request !== runtime.placementRequest ||
      touch === undefined
    ) {
      return;
    }
    updateDragTouch(drag, touch.clientX, touch.clientY);
    this.renderDragPreview(drag);
  },

  onMarkerTouchEnd(event: WechatMiniprogram.TouchEvent) {
    const runtime = pageRuntimes.get(this);
    if (runtime === undefined || !isPageRuntimeActive(this, runtime)) {
      return;
    }
    const drag = runtime.dragState;
    if (drag === null) {
      return;
    }
    const touch = event.changedTouches[0] ?? event.touches[0];
    if (touch !== undefined) {
      updateDragTouch(drag, touch.clientX, touch.clientY);
    }
    drag.ended = true;
    this.renderDragPreview(drag);
    void this.finalizeDrag(drag);
  },

  renderDragPreview(drag: DragState) {
    const runtime = pageRuntimes.get(this);
    if (
      runtime === undefined ||
      !isPageRuntimeActive(this, runtime) ||
      runtime.dragState !== drag ||
      drag.request !== runtime.placementRequest
    ) {
      return;
    }
    const draft = dragDraft(
      drag,
      runtime.stageLayout?.image,
      this.data.coverCircle,
      this.data.referenceCircle,
    );
    if (draft === null) {
      return;
    }
    this.setData({
      ...draft,
      ...this.markerStyles(draft.coverCircle, draft.referenceCircle),
    });
  },

  async finalizeDrag(drag: DragState) {
    const runtime = pageRuntimes.get(this);
    if (
      runtime === undefined ||
      !isPageRuntimeActive(this, runtime) ||
      runtime.dragState !== drag ||
      drag.request !== runtime.placementRequest ||
      drag.finalizing ||
      !drag.ended ||
      !drag.rectResolved
    ) {
      return;
    }
    drag.finalizing = true;
    if (!drag.moved || drag.imageRect === null) {
      runtime.dragState = null;
      return;
    }
    const draft = dragDraft(
      drag,
      runtime.stageLayout?.image,
      this.data.coverCircle,
      this.data.referenceCircle,
    );
    if (draft === null) {
      runtime.dragState = null;
      return;
    }
    const finalCircle = drag.marker === "cover"
      ? draft.coverCircle
      : draft.referenceCircle;
    if (finalCircle === null || circlesEqual(finalCircle, drag.original)) {
      runtime.dragState = null;
      return;
    }
    await this.persistSample(
      draft.coverCircle,
      draft.referenceCircle,
      drag.marker,
      drag.identity,
      `${markerLabel(drag.marker)}位置已调整。`,
      () =>
        isPageRuntimeActive(this, runtime) &&
        drag.request === runtime.placementRequest,
    );
    if (runtime.dragState === drag) {
      runtime.dragState = null;
    }
  },

  async onMarkerTouchCancel() {
    const runtime = pageRuntimes.get(this);
    if (runtime === undefined || !isPageRuntimeActive(this, runtime)) {
      return;
    }
    const identity = runtime.dragState?.identity ?? imageIdentityFromPage(this.data);
    runtime.placementRequest += 1;
    runtime.dragState = null;
    const snapshot = await appSessionStore.access();
    if (!isPageRuntimeActive(this, runtime)) {
      return;
    }
    if (snapshot.image === null || snapshot.image.analysis === null) {
      this.returnToEntry(snapshot.error?.message ?? "本次图片已清除，请重新选择。");
      return;
    }
    if (identity === null || !matchesImageIdentity(snapshot, identity)) {
      return;
    }
    this.renderStoredSample(snapshot.image, snapshot.sample, undefined, identity);
  },

  onShrinkRadius() {
    void this.changeRadius(-RADIUS_STEP);
  },

  async onToggleFineTune() {
    if (this.data.isAnalyzing || this.data.navigationBusy || !(await this.ensureActiveSession())) {
      return;
    }
    const fineTuneExpanded = !this.data.fineTuneExpanded;
    this.setData({ fineTuneExpanded });
  },

  async onUndoSample() {
    if (this.data.isAnalyzing || this.data.navigationBusy) {
      return;
    }
    const runtime = pageRuntimes.get(this);
    if (runtime === undefined || !isPageRuntimeActive(this, runtime)) {
      return;
    }
    const undo = runtime.undoSample;
    if (undo === null) {
      return;
    }
    const request = this.invalidatePendingInteraction();
    await this.persistSample(
      undo.coverCircle,
      undo.referenceCircle,
      undo.activeMarker,
      undo.identity,
      "已撤销上次取样调整。",
      () => isPageRuntimeActive(this, runtime) && request === runtime.placementRequest,
      true,
    );
  },

  onGrowRadius() {
    void this.changeRadius(RADIUS_STEP);
  },

  async changeRadius(delta: number) {
    this.invalidatePendingInteraction();
    const runtime = pageRuntimes.get(this);
    if (runtime === undefined || !isPageRuntimeActive(this, runtime)) {
      return;
    }
    const identity = imageIdentityFromPage(this.data);
    if (identity === null || !(await this.ensureActiveSession(identity))) {
      return;
    }
    const marker = this.data.activeMarker;
    const image = runtime.stageLayout?.image;
    if (marker === "" || image === undefined) {
      return;
    }
    const current = marker === "cover" ? this.data.coverCircle : this.data.referenceCircle;
    if (current === null) {
      return;
    }
    const next = { ...current, radius: clamp(current.radius + delta, MIN_RADIUS, MAX_RADIUS) };
    if (getCircleIssues(next, image).length > 0) {
      this.setData({
        messageText: `${marker === "cover" ? "A" : "B"} 取样范围已接近图片边缘，请先向内移动。`,
        messageKind: "inline-error",
      });
      return;
    }
    await this.persistSample(
      marker === "cover" ? next : this.data.coverCircle,
      marker === "reference" ? next : this.data.referenceCircle,
      marker,
      identity,
      `${markerLabel(marker)}取样范围已${delta < 0 ? "缩小" : "放大"}。`,
    );
  },

  onZoomOut() {
    void this.setZoom(this.data.zoom - 0.5);
  },

  onZoomIn() {
    void this.setZoom(this.data.zoom + 0.5);
  },

  async setZoom(value: number) {
    this.invalidatePendingInteraction();
    if (!(await this.ensureActiveSession())) {
      return;
    }
    const zoom = clamp(value, 1, 4);
    this.setData({ zoom, zoomText: `${Math.round(zoom * 100)}%` });
  },

  onScale(event: WechatMiniprogram.CustomEvent<ScaleDetail>) {
    if (typeof event.detail.scale !== "number") {
      return;
    }
    void this.applyScale(event.detail.scale);
  },

  async applyScale(value: number) {
    this.invalidatePendingInteraction();
    if (!(await this.ensureActiveSession())) {
      return;
    }
    const zoom = clamp(value, 1, 4);
    this.setData({ zoom, zoomText: `${Math.round(zoom * 100)}%` });
  },

  async persistSample(
    coverCircle: NormalizedCircle | null,
    referenceCircle: NormalizedCircle | null,
    activeMarker: MarkerKey,
    identity: SessionImageIdentity,
    announcement?: string,
    isCurrent: () => boolean = () => true,
    restoring = false,
  ) {
    const runtime = pageRuntimes.get(this);
    if (
      runtime === undefined ||
      !isPageRuntimeActive(this, runtime) ||
      !isCurrent() ||
      runtime.navigationBusy ||
      this.data.isAnalyzing
    ) {
      return;
    }
    const snapshot = await appSessionStore.access();
    if (!isPageRuntimeActive(this, runtime)) {
      return;
    }
    const image = snapshot.image;
    if (image === null || image.analysis === null) {
      this.returnToEntry("本次图片已清除，请重新选择。");
      return;
    }
    if (!isCurrent() || runtime.navigationBusy || this.data.isAnalyzing || !matchesImageIdentity(snapshot, identity)) {
      return;
    }
    const draft = { coverCircle, referenceCircle };
    const previousCover = snapshot.sample?.coverCircle ?? null;
    const previousReference = snapshot.sample?.referenceCircle ?? null;
    if (nullableCirclesEqual(previousCover, coverCircle) && nullableCirclesEqual(previousReference, referenceCircle)) {
      this.renderStoredSample(image, snapshot.sample, activeMarker, identity, announcement);
      return;
    }
    const inspection = inspectSample(image, draft);
    const sample: SamplePair = {
      ...draft,
      confirmed: inspection.confirmed,
      revision: (snapshot.sample?.revision ?? 0) + 1,
    };
    if (!isCurrent() || !appSessionStore.setSample(identity, sample, inspection.confirmed)) {
      return;
    }
    if (!isPageRuntimeActive(this, runtime)) {
      return;
    }
    const nextIdentity = appSessionStore.getImageIdentity();
    if (nextIdentity !== null) {
      runtime.undoSample = restoring ? null : {
        identity: nextIdentity,
        coverCircle: previousCover,
        referenceCircle: previousReference,
        activeMarker,
      };
      const nextActive = !restoring && previousCover === null && coverCircle !== null && referenceCircle === null
        ? "reference"
        : activeMarker;
      this.renderStoredSample(image, sample, nextActive, nextIdentity, announcement);
    }
  },

  renderStoredSample(
    image: AppSessionImage,
    sample: SamplePair | null,
    requestedActive?: MarkerKey,
    identity?: SessionImageIdentity,
    announcement?: string,
  ) {
    const current = appSessionStore.getSnapshot();
    if (current.image !== image ||
        (identity !== undefined && !matchesImageIdentity(current, identity))) {
      return;
    }
    const coverCircle = sample?.coverCircle ?? null;
    const referenceCircle = sample?.referenceCircle ?? null;
    const inspection = inspectSample(image, { coverCircle, referenceCircle });
    const activeMarker = requestedActive ?? this.data.activeMarker ?? "";
    const nextActive: MarkerKey = activeMarker !== ""
      ? activeMarker
      : coverCircle === null
        ? "cover"
        : "reference";
    const showValidation = coverCircle !== null && referenceCircle !== null;
    const messageText = showValidation
      ? inspection.message ?? inspection.warning ?? ""
      : "";
    const messageKind = inspection.message !== null
      ? "inline-error"
      : inspection.warning !== null
        ? "inline-warning"
        : "inline-info";
    this.setData({
      canUndo: pageRuntimes.get(this)?.undoSample != null,
      ...(identity === undefined
        ? {}
        : {
            sessionId: identity.sessionId,
            sessionRevision: identity.revision,
            imageVersion: identity.imageVersion,
          }),
      coverCircle,
      referenceCircle,
      activeMarker: nextActive,
      activeMarkerText: markerLabel(nextActive),
      canMoveActiveMarker:
        nextActive === "cover"
          ? coverCircle !== null
          : nextActive === "reference" && referenceCircle !== null,
      hasCover: coverCircle !== null,
      hasReference: referenceCircle !== null,
      coverColor: inspection.coverColor ?? "",
      referenceColor: inspection.referenceColor ?? "",
      coverColorText: colorText(inspection.coverColor),
      referenceColorText: colorText(inspection.referenceColor),
      coverSwatchStyle: swatchStyle(inspection.coverColor),
      referenceSwatchStyle: swatchStyle(inspection.referenceColor),
      coverStateText: coverCircle === null ? "未放置" : "已放置",
      referenceStateText: referenceCircle === null ? "未放置" : "已放置",
      promptText: samplePrompt(coverCircle, referenceCircle, nextActive, inspection.confirmed),
      statusText: announcement ?? sampleStatus(
        coverCircle,
        referenceCircle,
        nextActive,
        inspection.coverColor,
        inspection.referenceColor,
      ),
      canAnalyze: inspection.confirmed,
      messageText,
      messageKind,
      ...this.markerStyles(coverCircle, referenceCircle),
      ...this.radiusLimits(nextActive, coverCircle, referenceCircle),
    });
  },

  markerStyles(
    coverCircle: NormalizedCircle | null,
    referenceCircle: NormalizedCircle | null,
  ) {
    const layout = pageRuntimes.get(this)?.stageLayout ?? null;
    return {
      coverMarkerStyle: markerStyle(coverCircle, layout),
      referenceMarkerStyle: markerStyle(referenceCircle, layout),
    };
  },

  radiusLimits(
    marker: MarkerKey | "",
    coverCircle: NormalizedCircle | null,
    referenceCircle: NormalizedCircle | null,
  ) {
    const current = marker === "cover"
      ? coverCircle
      : marker === "reference"
        ? referenceCircle
        : null;
    const image = pageRuntimes.get(this)?.stageLayout?.image;
    if (current === null || image === undefined) {
      return { cannotShrink: true, cannotGrow: true };
    }
    const grown = { ...current, radius: Math.min(MAX_RADIUS, current.radius + RADIUS_STEP) };
    return {
      cannotShrink: current.radius <= MIN_RADIUS + 0.0001,
      cannotGrow:
        current.radius >= MAX_RADIUS - 0.0001 ||
        getCircleIssues(grown, image).length > 0,
    };
  },

  measureImageRect(): Promise<ElementRect | null> {
    return new Promise((resolve) => {
      this.createSelectorQuery()
        .select("#analysisImage")
        .boundingClientRect((
          rect: WechatMiniprogram.BoundingClientRectCallbackResult | null | undefined,
        ) => {
          if (rect === null || rect === undefined || rect.width <= 0 || rect.height <= 0) {
            resolve(null);
            return;
          }
          resolve({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
        })
        .exec();
    });
  },

  onTryOn() { return this.onAnalyze("studio"); },

  async onAnalyze(destination?: string) {
    this.invalidatePendingInteraction();
    const runtime = pageRuntimes.get(this);
    if (
      runtime === undefined ||
      !isPageRuntimeActive(this, runtime) ||
      runtime.navigationBusy
    ) {
      return;
    }
    const identity = imageIdentityFromPage(this.data);
    if (identity === null) {
      return;
    }
    const snapshot = await appSessionStore.access();
    if (!isPageRuntimeActive(this, runtime)) {
      return;
    }
    if (snapshot.image === null || snapshot.image.analysis === null) {
      this.returnToEntry(snapshot.error?.message ?? "本次图片已清除，请重新选择。");
      return;
    }
    if (!matchesImageIdentity(snapshot, identity)) {
      return;
    }
    if (!snapshot.sampleConfirmed || snapshot.sample === null) {
      this.renderStoredSample(snapshot.image, snapshot.sample, undefined, identity);
      return;
    }
    if (
      snapshot.phase === "RESULT" &&
      snapshot.result !== null &&
      snapshot.result.recommendation.sessionRevision === snapshot.revision &&
      snapshot.result.recommendation.catalogVersion === snapshot.catalogVersion
    ) {
      this.openResultPage(destination);
      return;
    }

    const outcome = await runLocalAnalysis(identity);
    if (!isPageRuntimeActive(this, runtime)) {
      return;
    }
    if (outcome.kind === "completed") {
      this.openResultPage(destination);
      return;
    }
    if (outcome.kind === "failed" || outcome.kind === "timeout") {
      const error = appSessionStore.getSnapshot().error;
      this.setData({
        messageText: error?.message ?? "本次分析未完成，请重试。",
        messageKind: "inline-error",
      });
      return;
    }
    if (
      outcome.kind === "stale" &&
      appSessionStore.getSnapshot().phase !== "ANALYZING"
    ) {
      this.setData({
        messageText: "取样或图片已更新，请重新查看取样结果。",
        messageKind: "inline-info",
      });
    }
  },

  openResultPage(destination?: string) {
    const runtime = pageRuntimes.get(this);
    if (
      runtime === undefined ||
      !isPageRuntimeActive(this, runtime) ||
      runtime.navigationBusy
    ) {
      return;
    }
    runtime.navigationBusy = true;
    this.setData({ navigationBusy: true });
    wx.navigateTo({
      url: destination === "studio" ? "/pages/studio/index" : "/pages/result/index",
      fail: () => {
        if (!isPageRuntimeActive(this, runtime)) {
          return;
        }
        runtime.navigationBusy = false;
        this.setData({
          navigationBusy: false,
          messageText: "分析已完成，但无法打开结果页，请重试。",
          messageKind: "inline-error",
        });
      },
    });
  },

  onCancelAnalysis() {
    this.invalidatePendingInteraction();
    appAnalysisCoordinator.cancel("user");
  },

  async onChooseAnother() {
    this.invalidatePendingInteraction(false);
    const runtime = pageRuntimes.get(this);
    if (
      runtime === undefined ||
      !isPageRuntimeActive(this, runtime) ||
      runtime.navigationBusy
    ) {
      return;
    }
    runtime.navigationBusy = true;
    this.setData({ navigationBusy: true });
    await appSessionStore.restart();
    if (isPageRuntimeActive(this, runtime)) {
      wx.reLaunch({
        url: "/pages/entry/index",
        fail: () => {
          if (!isPageRuntimeActive(this, runtime)) {
            return;
          }
          runtime.navigationBusy = false;
          this.setData({
            navigationBusy: false,
            messageText: "无法返回开始页，请重试。",
            messageKind: "inline-error",
          });
        },
      });
    }
  },

  async ensureActiveSession(
    identity?: SessionImageIdentity | null,
  ): Promise<boolean> {
    const runtime = pageRuntimes.get(this);
    if (runtime === undefined || !isPageRuntimeActive(this, runtime)) {
      return false;
    }
    const expectedIdentity = identity === undefined
      ? imageIdentityFromPage(this.data)
      : identity;
    const snapshot = await appSessionStore.access();
    if (!isPageRuntimeActive(this, runtime)) {
      return false;
    }
    if (snapshot.image === null || snapshot.image.analysis === null) {
      this.returnToEntry(snapshot.error?.message ?? "本次图片已清除，请重新选择。");
      return false;
    }
    if (
      expectedIdentity === null ||
      !matchesImageIdentity(snapshot, expectedIdentity)
    ) {
      return false;
    }
    appSessionStore.touch();
    return true;
  },

  invalidatePendingInteraction(restoreDrag = true): number {
    const runtime = pageRuntimes.get(this);
    if (runtime === undefined || !isPageRuntimeActive(this, runtime)) {
      return -1;
    }
    runtime.placementRequest += 1;
    const drag = runtime.dragState;
    runtime.dragState = null;
    if (!restoreDrag || drag === null) {
      return runtime.placementRequest;
    }
    const snapshot = appSessionStore.getSnapshot();
    const identity = imageIdentityFromSnapshot(snapshot);
    if (
      snapshot.image !== null &&
      snapshot.image.analysis !== null &&
      identity !== null &&
      matchesImageGeneration(snapshot, drag.identity)
    ) {
      this.renderStoredSample(snapshot.image, snapshot.sample, undefined, identity);
    }
    return runtime.placementRequest;
  },

  returnToEntry(message: string) {
    const runtime = pageRuntimes.get(this);
    if (
      runtime === undefined ||
      !isPageRuntimeActive(this, runtime) ||
      runtime.returningToEntry
    ) {
      return;
    }
    runtime.returningToEntry = true;
    wx.showModal({
      title: "需要重新选择图片",
      content: message,
      showCancel: false,
      success: () => {
        if (isPageRuntimeActive(this, runtime)) {
          wx.reLaunch({ url: "/pages/entry/index" });
        }
      },
      fail: () => {
        if (isPageRuntimeActive(this, runtime)) {
          wx.reLaunch({ url: "/pages/entry/index" });
        }
      },
    });
  },
});

function imageIdentityFromPage(
  data: Pick<SamplePageData, "sessionId" | "sessionRevision" | "imageVersion">,
): SessionImageIdentity | null {
  return data.sessionId && data.imageVersion && data.sessionRevision >= 0
    ? {
        sessionId: data.sessionId,
        revision: data.sessionRevision,
        imageVersion: data.imageVersion,
      }
    : null;
}

function isPageRuntimeActive(page: object, runtime: PageRuntime): boolean {
  return runtime.alive && pageRuntimes.get(page) === runtime;
}

function imageIdentityFromSnapshot(
  snapshot: ReturnType<typeof appSessionStore.getSnapshot>,
): SessionImageIdentity | null {
  return snapshot.sessionId !== null && snapshot.imageVersion !== null
    ? {
        sessionId: snapshot.sessionId,
        revision: snapshot.revision,
        imageVersion: snapshot.imageVersion,
      }
    : null;
}

function isMoveDirection(value: unknown): value is MoveDirection {
  return value === "up" || value === "down" || value === "left" || value === "right";
}

function markerLabel(marker: MarkerKey): string {
  return marker === "cover" ? "A 待遮盖处" : "B 周边肤色";
}

function directionLabel(direction: MoveDirection): string {
  switch (direction) {
    case "up":
      return "向上移动";
    case "down":
      return "向下移动";
    case "left":
      return "向左移动";
    case "right":
      return "向右移动";
  }
}

function positionText(circle: NormalizedCircle): string {
  return `横向 ${Math.round(circle.x * 100)}%，纵向 ${Math.round(circle.y * 100)}%`;
}

function colorText(color: string | null): string {
  return color === null ? "颜色未获取" : `颜色 ${color.toUpperCase()}`;
}

function samplePrompt(
  cover: NormalizedCircle | null,
  reference: NormalizedCircle | null,
  active: MarkerKey,
  confirmed: boolean,
): string {
  if (cover === null) {
    return active === "reference"
      ? "当前选择 B 周边肤色；放置后还需选择 A 待遮盖处"
      : "点一下待遮盖处，放置 A；也可展开微调用按钮放置";
  }
  if (reference === null) {
    return active === "cover"
      ? "当前调整 A；选择 B 后点选周边肤色"
      : "A 已放置；再点一下希望接近的周边肤色，放置 B";
  }
  return confirmed
    ? "两处取样已就绪，可圈选试妆；需要时拖动圆框微调"
    : "请根据下方提示调整取样；可拖动圆框或展开微调";
}

function sampleStatus(
  coverCircle: NormalizedCircle | null,
  referenceCircle: NormalizedCircle | null,
  activeMarker: MarkerKey | "",
  coverColor: string | null,
  referenceColor: string | null,
): string {
  if (coverCircle === null) {
    return "尚未放置取样区域。先选择 A 待遮盖处。";
  }
  if (referenceCircle === null) {
    return `A 待遮盖处已放置，${colorText(coverColor)}。请选择 B 周边肤色。`;
  }
  const activeText = activeMarker === "" ? "尚未选择调整区域" : `当前调整${markerLabel(activeMarker)}`;
  return `两处取样均已放置。A ${colorText(coverColor)}，B ${colorText(referenceColor)}。${activeText}，请查看取样检查提示。`;
}

function matchesImageIdentity(
  snapshot: ReturnType<typeof appSessionStore.getSnapshot>,
  identity: SessionImageIdentity,
): boolean {
  return (
    snapshot.sessionId === identity.sessionId &&
    snapshot.revision === identity.revision &&
    snapshot.imageVersion === identity.imageVersion
  );
}

function matchesImageGeneration(
  snapshot: ReturnType<typeof appSessionStore.getSnapshot>,
  identity: SessionImageIdentity,
): boolean {
  return (
    snapshot.sessionId === identity.sessionId &&
    snapshot.imageVersion === identity.imageVersion
  );
}

function updateDragTouch(drag: DragState, clientX: number, clientY: number): void {
  drag.lastX = clientX;
  drag.lastY = clientY;
  drag.moved = drag.moved ||
    Math.abs(clientX - drag.startX) >= 0.5 ||
    Math.abs(clientY - drag.startY) >= 0.5;
}

function circlesEqual(left: NormalizedCircle, right: NormalizedCircle): boolean {
  return left.x === right.x && left.y === right.y && left.radius === right.radius;
}

function nullableCirclesEqual(left: NormalizedCircle | null, right: NormalizedCircle | null): boolean {
  return left === null || right === null ? left === right : circlesEqual(left, right);
}

function dragDraft(
  drag: DragState,
  image: NonNullable<AppSessionImage["analysis"]> | undefined,
  coverCircle: NormalizedCircle | null,
  referenceCircle: NormalizedCircle | null,
): Pick<SamplePageData, "coverCircle" | "referenceCircle"> | null {
  const rect = drag.imageRect;
  if (
    !drag.moved ||
    rect === null ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    image === undefined
  ) {
    return null;
  }
  const moved = clampCircle(
    {
      x: drag.original.x + (drag.lastX - drag.startX) / rect.width,
      y: drag.original.y + (drag.lastY - drag.startY) / rect.height,
      radius: drag.original.radius,
    },
    image,
  );
  return {
    coverCircle: drag.marker === "cover" ? moved : coverCircle,
    referenceCircle: drag.marker === "reference" ? moved : referenceCircle,
  };
}

function markerStyle(circle: NormalizedCircle | null, layout: StageLayout | null): string {
  if (circle === null || layout === null) {
    return "";
  }
  const transform = layout.imageTransform;
  const centerX = transform.offsetX + circle.x * transform.displayedWidth;
  const centerY = transform.offsetY + circle.y * transform.displayedHeight;
  const ringSize = Math.max(
    1,
    2 * circle.radius * Math.min(layout.image.width, layout.image.height) * transform.scale,
  );
  const touchSize = Math.max(1, ringSize);
  return [
    `left:${centerX}px`,
    `top:${centerY}px`,
    `width:${touchSize}px`,
    `height:${touchSize}px`,
    `--ring-size:${ringSize}px`,
  ].join(";");
}

function imageStyle(transform: ContainTransform): string {
  return [
    `left:${transform.offsetX}px`,
    `top:${transform.offsetY}px`,
    `width:${transform.displayedWidth}px`,
    `height:${transform.displayedHeight}px`,
  ].join(";");
}

function swatchStyle(color: string | null): string {
  return color === null ? "" : `background-color:${color};`;
}

function clampCircle(
  circle: NormalizedCircle,
  image: NonNullable<AppSessionImage["analysis"]>,
): NormalizedCircle {
  const shortEdge = Math.min(image.width, image.height);
  const marginX = (circle.radius * shortEdge) / image.width;
  const marginY = (circle.radius * shortEdge) / image.height;
  return {
    x: clamp(circle.x, marginX, 1 - marginX),
    y: clamp(circle.y, marginY, 1 - marginY),
    radius: circle.radius,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function stageCopy(stage: "checking_image" | "extracting_color" | "finding_candidates"): string {
  switch (stage) {
    case "checking_image":
      return "正在检查图片";
    case "extracting_color":
      return "正在提取颜色";
    case "finding_candidates":
      return "正在查找候选色号";
  }
}
