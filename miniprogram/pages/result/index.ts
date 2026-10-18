import {
  type CatalogEntry,
  type CommerceRoute,
  type Recommendation,
} from "../../core/index";
import { appCommerceAdapter } from "../../adapters/index";
import {
  appSessionStore,
  type AnalysisResult,
  type AppSessionImage,
  type CommerceOperation,
  type SamplePair,
} from "../../session/index";
import { presentRecommendation, qualityNotice, resultMarkerStyle } from "../shared/result-presentation";

interface CandidateView {
  readonly skuId: string;
  readonly label: string;
  readonly brand: string;
  readonly name: string;
  readonly shadeCode: string;
  readonly shadeName: string;
  readonly imageAsset: string;
  readonly verifiedAt: string;
  readonly reason: string;
  readonly selected: boolean;
  readonly accessibilityLabel: string;
}

interface ResultPageData {
  readonly resultTitle: string;
  readonly emptyTitle: string;
  readonly emptyCopy: string;
  readonly qualityText: string;
  readonly photoFrameStyle: string;
  readonly coverMarkerStyle: string;
  readonly referenceMarkerStyle: string;
  readonly cleared: boolean;
  readonly conclusionText: string;
  readonly coverColor: string;
  readonly referenceColor: string;
  readonly coverColorText: string;
  readonly referenceColorText: string;
  readonly coverSwatchStyle: string;
  readonly referenceSwatchStyle: string;
  readonly imagePath: string;
  readonly imageExpanded: boolean;
  readonly hasCandidates: boolean;
  readonly candidates: readonly CandidateView[];
  readonly candidateSectionTitle: string;
  readonly isRanked: boolean;
  readonly isReferenceOnly: boolean;
  readonly commerceError: string;
  readonly commerceOpening: boolean;
  readonly navigationBusy: boolean;
  readonly showCommerceAction: boolean;
  readonly commerceSummaryLabel: string;
  readonly selectedShadeText: string;
  readonly commerceButtonText: string;
  readonly resultStatusText: string;
}

interface CandidateDataset {
  readonly skuId?: string;
}

interface ResultIdentity {
  readonly sessionId: string;
  readonly revision: number;
  readonly imageVersion: string;
  readonly catalogVersion: string;
  readonly skuId: string;
}

interface ResultPageRuntime {
  alive: boolean;
  operation: number;
  navigationBusy: boolean;
  initialized: boolean;
  returningToEntry: boolean;
  selectedSkuId: string;
}

const resultPageRuntimes = new WeakMap<object, ResultPageRuntime>();

Page<ResultPageData, WechatMiniprogram.Page.CustomOption>({
  data: {
    resultTitle: "本次结果",
    emptyTitle: "",
    emptyCopy: "",
    qualityText: "",
    photoFrameStyle: "",
    coverMarkerStyle: "",
    referenceMarkerStyle: "",
    cleared: false,
    conclusionText: "正在读取本次结果。",
    coverColor: "",
    referenceColor: "",
    coverColorText: "颜色未获取",
    referenceColorText: "颜色未获取",
    coverSwatchStyle: "",
    referenceSwatchStyle: "",
    imagePath: "",
    imageExpanded: false,
    hasCandidates: false,
    candidates: [],
    candidateSectionTitle: "试色候选",
    isRanked: false,
    isReferenceOnly: false,
    commerceError: "",
    commerceOpening: false,
    navigationBusy: false,
    showCommerceAction: false,
    commerceSummaryLabel: "当前色号",
    selectedShadeText: "",
    commerceButtonText: "查看官方商品",
    resultStatusText: "正在读取本次结果。",
  },

  onLoad() {
    resultPageRuntimes.set(this, {
      alive: true,
      operation: 0,
      navigationBusy: false,
      initialized: false,
      returningToEntry: false,
      selectedSkuId: "",
    });
    void this.initializePage();
  },

  async onShow() {
    const runtime = resultPageRuntimes.get(this);
    if (
      runtime === undefined ||
      !isResultPageActive(this, runtime) ||
      !runtime.initialized
    ) {
      return;
    }
    const snapshot = await appSessionStore.access();
    if (!isResultPageActive(this, runtime)) {
      return;
    }
    if (!isRenderableResult(snapshot)) {
      this.leaveInvalidResult(snapshot, snapshot.error?.message ?? "本次结果已失效，请重新取样。");
      return;
    }
    appSessionStore.touch();
    this.renderResult(snapshot.image, snapshot.result, snapshot.commerce, snapshot.sample);
  },

  onUnload() {
    const runtime = resultPageRuntimes.get(this);
    if (runtime !== undefined) {
      runtime.alive = false;
      runtime.operation += 1;
      runtime.navigationBusy = false;
      resultPageRuntimes.delete(this);
    }
  },

  async initializePage() {
    const runtime = resultPageRuntimes.get(this);
    if (runtime === undefined || !isResultPageActive(this, runtime)) {
      return;
    }
    const snapshot = await appSessionStore.access();
    if (!isResultPageActive(this, runtime)) {
      return;
    }
    if (!isRenderableResult(snapshot)) {
      this.leaveInvalidResult(snapshot, snapshot.error?.message ?? "本次结果已失效，请重新取样。");
      return;
    }
    runtime.initialized = true;
    appSessionStore.touch();
    this.renderResult(snapshot.image, snapshot.result, snapshot.commerce, snapshot.sample);
  },

  renderResult(
    image: AppSessionImage,
    result: AnalysisResult,
    commerceOperation: CommerceOperation,
    sample: SamplePair,
  ) {
    const runtime = resultPageRuntimes.get(this);
    const current = appSessionStore.getSnapshot();
    if (runtime === undefined || !isResultPageActive(this, runtime) ||
        runtime.navigationBusy || this.data.cleared ||
        current.image !== image || current.result !== result) {
      return;
    }
    const recommendation = result.recommendation;
    const entries = recommendation.candidates.map((candidate) => candidate.entry);
    if (!entries.some((entry) => entry.skuId === runtime.selectedSkuId)) {
      runtime.selectedSkuId = entries[0]?.skuId ?? "";
    }
    const candidates = entries.map((entry, index) =>
      candidateView(
        entry,
        index,
        recommendation.status,
        entry.skuId === runtime.selectedSkuId,
      ),
    );
    const selectedEntry = entries.find(
      (entry) => entry.skuId === runtime.selectedSkuId,
    ) ?? null;
    const commerce = commercePresentation(selectedEntry);
    const commerceForSelection = selectedEntry !== null &&
      commerceOperation.status !== "idle" &&
      commerceOperation.skuId === selectedEntry.skuId;
    const presentation = presentRecommendation(recommendation);
    const conclusionText = presentation.conclusion;
    const imageSize = image.analysisPlan;

    this.setData({
      resultTitle: presentation.title,
      emptyTitle: presentation.emptyTitle,
      emptyCopy: presentation.emptyCopy,
      qualityText: qualityNotice(result.colorSummary),
      photoFrameStyle: `width:${Math.min(100, 100 * imageSize.width / imageSize.height)}%;`,
      coverMarkerStyle: sample.coverCircle === null ? "" : resultMarkerStyle(sample.coverCircle, imageSize),
      referenceMarkerStyle: sample.referenceCircle === null ? "" : resultMarkerStyle(sample.referenceCircle, imageSize),
      conclusionText,
      coverColor: result.previewColors.cover,
      referenceColor: result.previewColors.reference,
      coverColorText: colorText(result.previewColors.cover),
      referenceColorText: colorText(result.previewColors.reference),
      coverSwatchStyle: swatchStyle(result.previewColors.cover),
      referenceSwatchStyle: swatchStyle(result.previewColors.reference),
      imagePath: image.previewRef,
      hasCandidates: candidates.length > 0,
      candidates,
      candidateSectionTitle: recommendation.status === "reference_only"
        ? "参考候选（不分先后）"
        : "试色候选",
      isRanked: recommendation.status === "ranked",
      isReferenceOnly: recommendation.status === "reference_only",
      commerceError: commerceForSelection && commerceOperation.status === "failed"
        ? commerceOperation.message
        : "",
      commerceOpening: commerceForSelection && commerceOperation.status === "opening",
      resultStatusText: selectedEntry === null
        ? conclusionText
        : `${conclusionText} 当前已选择色号 ${selectedEntry.shadeCode} ${selectedEntry.shadeName}。`,
      ...commerce,
    });
  },

  async onToggleImage() {
    const runtime = resultPageRuntimes.get(this);
    if (
      runtime === undefined ||
      !isResultPageActive(this, runtime) ||
      runtime.navigationBusy ||
      this.data.commerceOpening
    ) {
      return;
    }
    const operation = ++runtime.operation;
    const snapshot = await appSessionStore.access();
    if (!isResultOperationActive(this, runtime, operation)) {
      return;
    }
    if (!isRenderableResult(snapshot)) {
      this.leaveInvalidResult(snapshot, snapshot.error?.message ?? "本次结果已失效，请重新取样。");
      return;
    }
    appSessionStore.touch();
    const imageExpanded = !this.data.imageExpanded;
    this.setData({
      imageExpanded,
      resultStatusText: `取样图片已${imageExpanded ? "展开" : "收起"}。`,
    });
  },

  async onSelectCandidate(
    event: WechatMiniprogram.BaseEvent<WechatMiniprogram.IAnyObject, CandidateDataset>,
  ) {
    const runtime = resultPageRuntimes.get(this);
    if (
      runtime === undefined ||
      !isResultPageActive(this, runtime) ||
      runtime.navigationBusy ||
      this.data.commerceOpening
    ) {
      return;
    }
    const skuId = event.currentTarget.dataset.skuId;
    if (typeof skuId !== "string" || !skuId) {
      return;
    }
    const operation = ++runtime.operation;
    const snapshot = await appSessionStore.access();
    if (!isResultOperationActive(this, runtime, operation)) {
      return;
    }
    const recommendation = snapshot.result?.recommendation ?? null;
    if (!isRenderableResult(snapshot) || recommendation === null) {
      this.leaveInvalidResult(snapshot, snapshot.error?.message ?? "本次结果已失效，请重新取样。");
      return;
    }
    const selected = recommendation.candidates.find(
      (candidate) => candidate.entry.skuId === skuId,
    );
    if (selected === undefined) {
      return;
    }
    runtime.selectedSkuId = skuId;
    appSessionStore.touch();
    this.setData({
      candidates: this.data.candidates.map((candidate) => ({
        ...candidate,
        selected: candidate.skuId === skuId,
        accessibilityLabel: candidateAccessibilityLabel(
          candidate.label,
          candidate.brand,
          candidate.name,
          candidate.shadeCode,
          candidate.shadeName,
          candidate.skuId === skuId,
        ),
      })),
      commerceError: "",
      resultStatusText: `已选择色号 ${selected.entry.shadeCode} ${selected.entry.shadeName}。`,
      ...commercePresentation(selected.entry),
    });
  },

  async onOpenCommerce() {
    const runtime = resultPageRuntimes.get(this);
    if (
      runtime === undefined ||
      !isResultPageActive(this, runtime) ||
      runtime.navigationBusy ||
      this.data.commerceOpening ||
      !this.data.showCommerceAction
    ) {
      return;
    }
    const operation = ++runtime.operation;
    const snapshot = await appSessionStore.access();
    if (!isResultOperationActive(this, runtime, operation)) {
      return;
    }
    if (!isRenderableResult(snapshot)) {
      this.leaveInvalidResult(snapshot, snapshot.error?.message ?? "本次结果已失效，请重新取样。");
      return;
    }
    const selected = snapshot.result.recommendation.candidates.find(
      (candidate) => candidate.entry.skuId === runtime.selectedSkuId,
    );
    const route = selected?.entry.commerceRoute ?? null;
    if (selected === undefined || !canOpenCommerceRoute(route)) {
      this.setData({
        showCommerceAction: false,
        commerceError: "当前官方入口暂不可用，请稍后重试。",
      });
      return;
    }

    const identity: ResultIdentity = {
      sessionId: snapshot.sessionId,
      revision: snapshot.revision,
      imageVersion: snapshot.imageVersion,
      catalogVersion: snapshot.catalogVersion,
      skuId: selected.entry.skuId,
    };
    appSessionStore.touch();
    if (
      !appSessionStore.setCommerceOperation(identity, {
        status: "opening",
        skuId: identity.skuId,
      })
    ) {
      return;
    }
    this.setData({ commerceOpening: true, commerceError: "" });

    let errorMessage = "";
    try {
      const outcome = await appCommerceAdapter.openFromUserGesture(route);
      if (
        outcome.kind === "unavailable" ||
        (outcome.kind === "failed" && outcome.reason === "invalid_verified_route")
      ) {
        errorMessage = "当前官方入口暂不可用，请稍后重试。";
      } else if (outcome.kind === "failed") {
        errorMessage = "未能打开官方商品页，请稍后重试。";
      }
    } catch (_error) {
      errorMessage = "未能打开官方商品页，请稍后重试。";
    }

    const current = await appSessionStore.access();
    if (!isSameResult(current, identity)) {
      return;
    }
    if (errorMessage) {
      appSessionStore.setCommerceOperation(identity, {
        status: "failed",
        skuId: identity.skuId,
        message: errorMessage,
      });
    } else {
      appSessionStore.setCommerceOperation(identity, { status: "idle" });
    }
    if (!isResultOperationActive(this, runtime, operation)) {
      return;
    }
    this.setData({ commerceOpening: false, commerceError: errorMessage });
  },

  async onAdjustSample() {
    const runtime = resultPageRuntimes.get(this);
    if (
      runtime === undefined ||
      !isResultPageActive(this, runtime) ||
      runtime.navigationBusy ||
      this.data.commerceOpening
    ) {
      return;
    }
    runtime.navigationBusy = true;
    const operation = ++runtime.operation;
    this.setData({ navigationBusy: true });
    const snapshot = await appSessionStore.access();
    if (!isResultOperationActive(this, runtime, operation)) {
      return;
    }
    if (snapshot.image === null || snapshot.image.analysis === null) {
      runtime.navigationBusy = false;
      this.setData({ navigationBusy: false });
      this.leaveInvalidResult(snapshot, snapshot.error?.message ?? "本次图片已清除，请重新选择。");
      return;
    }
    appSessionStore.touch();
    const pages = getCurrentPages();
    const sampleIndex = pages.findIndex((page) => page.route === "pages/sample/index");
    const delta = sampleIndex < 0 ? 0 : pages.length - 1 - sampleIndex;
    if (delta > 0) {
      wx.navigateBack({
        delta,
        fail: () => {
          if (!isResultOperationActive(this, runtime, operation)) {
            return;
          }
          wx.redirectTo({
            url: "/pages/sample/index",
            fail: () => {
              if (!isResultOperationActive(this, runtime, operation)) {
                return;
              }
              runtime.navigationBusy = false;
              this.setData({
                navigationBusy: false,
                commerceError: "无法打开取样页，请重试。",
              });
            },
          });
        },
      });
      return;
    }
    wx.redirectTo({
      url: "/pages/sample/index",
      fail: () => {
        if (!isResultOperationActive(this, runtime, operation)) {
          return;
        }
        runtime.navigationBusy = false;
        this.setData({
          navigationBusy: false,
          commerceError: "无法打开取样页，请重试。",
        });
      },
    });
  },

  async onRestart() {
    const runtime = resultPageRuntimes.get(this);
    if (
      runtime === undefined ||
      !isResultPageActive(this, runtime) ||
      runtime.navigationBusy ||
      this.data.commerceOpening
    ) {
      return;
    }
    runtime.navigationBusy = true;
    const operation = ++runtime.operation;
    this.setData({ navigationBusy: true });
    this.clearVisibleResult();
    await appSessionStore.restart();
    if (!isResultOperationActive(this, runtime, operation)) {
      return;
    }
    wx.reLaunch({
      url: "/pages/entry/index",
      fail: () => {
        if (!isResultOperationActive(this, runtime, operation)) {
          return;
        }
        runtime.navigationBusy = false;
        this.setData({
          navigationBusy: false,
          commerceError: "无法返回开始页，请重试。",
        });
      },
    });
  },

  clearVisibleResult() {
    this.setData({
      cleared: true,
      imagePath: "", imageExpanded: false,
      coverColor: "", referenceColor: "", coverColorText: "", referenceColorText: "",
      coverSwatchStyle: "", referenceSwatchStyle: "",
      coverMarkerStyle: "", referenceMarkerStyle: "",
      candidates: [], hasCandidates: false, showCommerceAction: false,
      qualityText: "", selectedShadeText: "", commerceError: "",
      resultStatusText: "本次图片与取样已清除。",
    });
  },

  leaveInvalidResult(
    snapshot: ReturnType<typeof appSessionStore.getSnapshot>,
    message: string,
  ) {
    const runtime = resultPageRuntimes.get(this);
    if (
      runtime === undefined ||
      !isResultPageActive(this, runtime) ||
      runtime.returningToEntry ||
      runtime.navigationBusy
    ) {
      return;
    }
    runtime.returningToEntry = true;
    runtime.navigationBusy = true;
    const operation = ++runtime.operation;
    this.setData({ navigationBusy: true });
    const canReturnToSample = snapshot.image !== null && snapshot.image.analysis !== null;
    if (!canReturnToSample) {
      this.clearVisibleResult();
    }
    const navigate = () => {
      if (!isResultOperationActive(this, runtime, operation)) {
        return;
      }
      const onNavigationFailure = () => {
        if (!isResultOperationActive(this, runtime, operation)) {
          return;
        }
        runtime.returningToEntry = false;
        runtime.navigationBusy = false;
        this.setData({
          navigationBusy: false,
          commerceError: "无法返回上一流程，请重试。",
        });
      };
      if (canReturnToSample) {
        wx.redirectTo({
          url: "/pages/sample/index",
          fail: onNavigationFailure,
        });
      } else {
        wx.reLaunch({
          url: "/pages/entry/index",
          fail: onNavigationFailure,
        });
      }
    };
    wx.showModal({
      title: canReturnToSample ? "结果已更新" : "结果不可用",
      content: message,
      showCancel: false,
      success: navigate,
      fail: navigate,
    });
  },
});

function isResultPageActive(
  page: object,
  runtime: ResultPageRuntime,
): boolean {
  return runtime.alive && resultPageRuntimes.get(page) === runtime;
}

function isResultOperationActive(
  page: object,
  runtime: ResultPageRuntime,
  operation: number,
): boolean {
  return isResultPageActive(page, runtime) && runtime.operation === operation;
}

function isRenderableResult(
  snapshot: ReturnType<typeof appSessionStore.getSnapshot>,
): snapshot is ReturnType<typeof appSessionStore.getSnapshot> & {
  readonly phase: "RESULT";
  readonly sessionId: string;
  readonly imageVersion: string;
  readonly image: AppSessionImage;
  readonly sample: SamplePair;
    readonly result: AnalysisResult;
} {
  return (
    snapshot.phase === "RESULT" &&
    snapshot.sessionId !== null &&
    snapshot.imageVersion !== null &&
    snapshot.image !== null &&
    snapshot.image.analysis !== null &&
    snapshot.sample !== null &&
    snapshot.sampleConfirmed &&
    snapshot.result !== null &&
    snapshot.result.recommendation.sessionRevision === snapshot.revision &&
    snapshot.result.recommendation.catalogVersion === snapshot.catalogVersion
  );
}

function isSameResult(
  snapshot: ReturnType<typeof appSessionStore.getSnapshot>,
  identity: ResultIdentity,
): boolean {
  return (
    snapshot.phase === "RESULT" &&
    snapshot.sessionId === identity.sessionId &&
    snapshot.revision === identity.revision &&
    snapshot.imageVersion === identity.imageVersion &&
    snapshot.catalogVersion === identity.catalogVersion &&
    snapshot.result?.recommendation.candidates.some(
      (candidate) => candidate.entry.skuId === identity.skuId,
    ) === true
  );
}

function candidateView(
  entry: CatalogEntry,
  index: number,
  status: Recommendation["status"],
  selected: boolean,
): CandidateView {
  const label = status === "reference_only" ? "参考候选" : `候选 ${index + 1}`;
  const reason = status === "reference_only"
    ? "来自已核验的官方色系映射，未按颜色距离排序。"
    : "在同一已验证颜色协议内，色样距离较近；仍需实际试色。";
  return {
    skuId: entry.skuId,
    label,
    brand: entry.brand,
    name: entry.name,
    shadeCode: entry.shadeCode,
    shadeName: entry.shadeName,
    imageAsset: entry.imageAsset,
    verifiedAt: entry.verifiedAt,
    reason,
    selected,
    accessibilityLabel: candidateAccessibilityLabel(
      label,
      entry.brand,
      entry.name,
      entry.shadeCode,
      entry.shadeName,
      selected,
    ),
  };
}

function candidateAccessibilityLabel(
  label: string,
  brand: string,
  name: string,
  shadeCode: string,
  shadeName: string,
  selected: boolean,
): string {
  return `${label}，${selected ? "已选中" : "未选中"}，${brand} ${name}，色号 ${shadeCode} ${shadeName}`;
}

function commercePresentation(entry: CatalogEntry | null) {
  const route = entry?.commerceRoute ?? null;
  if (entry === null || !canOpenCommerceRoute(route)) {
    return {
      showCommerceAction: false,
      commerceSummaryLabel: "当前色号",
      selectedShadeText: "",
      commerceButtonText: "查看官方商品",
    };
  }
  return {
    showCommerceAction: true,
    commerceSummaryLabel: route.skuPreselectVerified
      ? "当前色号"
      : "请在商城选择色号",
    selectedShadeText: `${entry.shadeCode} ${entry.shadeName}`,
    commerceButtonText: route.skuPreselectVerified
      ? "去官方购买"
      : "查看官方商品",
  };
}

function canOpenCommerceRoute(
  route: CommerceRoute | null,
): route is CommerceRoute & {
  readonly kind: "mini_program";
  readonly appId: string;
  readonly path: string;
} {
  return (
    route !== null &&
    route.kind === "mini_program" &&
    route.appId !== null &&
    route.appId.trim().length > 0 &&
    route.path !== null &&
    route.path.trim().length > 0 &&
    route.url === null &&
    route.deviceEvidenceRef.trim().length > 0
  );
}

function swatchStyle(color: string | null): string {
  return color === null ? "" : `background-color:${color};`;
}

function colorText(color: string | null): string {
  return color === null ? "颜色未获取" : `颜色 ${color.toUpperCase()}`;
}
