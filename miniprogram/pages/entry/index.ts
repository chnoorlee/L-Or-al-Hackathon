import {
  WeChatMediaAdapter,
  type AnalysisImagePlan,
  type ChosenImage,
  type FixedAnalysisImage,
  type MediaSource,
} from "../../adapters/index";
import {
  appSessionRuntime,
  appSessionStore,
  type SessionImageIdentity,
} from "../../session/index";
import { PRODUCTION_CATALOG } from "../../data/catalog.production";

interface EntryPageData {
  readonly catalogEmpty: boolean;
  readonly isBusy: boolean;
  readonly pendingSource: MediaSource | null;
  readonly privacyDialogVisible: boolean;
  readonly errorMessage: string;
  readonly canOpenSettings: boolean;
  readonly guideExpanded: boolean;
}

interface MaterializedCanvasImage {
  readonly fixedImage: FixedAnalysisImage;
  readonly previewRef: string;
}

interface CanvasNodeResult {
  readonly node?: WechatMiniprogram.Canvas;
}

interface EntryPageRuntime {
  alive: boolean;
  request: number;
  navigationBusy: boolean;
}

const mediaAdapter = new WeChatMediaAdapter(wx);
const entryPageRuntimes = new WeakMap<object, EntryPageRuntime>();

Page<EntryPageData, WechatMiniprogram.Page.CustomOption>({
  data: {
    catalogEmpty: PRODUCTION_CATALOG.length === 0,
    isBusy: false,
    pendingSource: null,
    privacyDialogVisible: false,
    errorMessage: "",
    canOpenSettings: false,
    guideExpanded: false,
  },

  onLoad() {
    entryPageRuntimes.set(this, {
      alive: true,
      request: 0,
      navigationBusy: false,
    });
  },

  onShow() {
    const runtime = entryPageRuntimes.get(this);
    if (runtime !== undefined && isEntryPageActive(this, runtime) && runtime.navigationBusy) {
      runtime.navigationBusy = false;
      runtime.request += 1;
      this.setData({ isBusy: false, pendingSource: null });
    }
    void appSessionStore.expireIfNeeded();
  },

  onUnload() {
    const runtime = entryPageRuntimes.get(this);
    if (runtime !== undefined) {
      runtime.alive = false;
      runtime.request += 1;
      entryPageRuntimes.delete(this);
    }
  },

  onChooseCamera() {
    this.requestMedia("camera");
  },

  onToggleGuide() {
    if (!this.data.privacyDialogVisible) this.setData({ guideExpanded: !this.data.guideExpanded });
  },

  onChooseAlbum() {
    this.requestMedia("album");
  },

  onLiveTryOn() {
    const runtime = entryPageRuntimes.get(this);
    if (!runtime || runtime.navigationBusy || this.data.isBusy || this.data.privacyDialogVisible) return;
    runtime.navigationBusy = true;
    wx.navigateTo({ url: "/pages/live/index", fail: () => {
      if (!isEntryPageActive(this, runtime)) return;
      runtime.navigationBusy = false;
      this.setData({ errorMessage: "无法打开实时试妆，请重试。" });
    } });
  },

  requestMedia(source: MediaSource) {
    const runtime = entryPageRuntimes.get(this);
    if (
      runtime === undefined ||
      !isEntryPageActive(this, runtime) ||
      runtime.navigationBusy ||
      this.data.isBusy ||
      this.data.pendingSource !== null ||
      this.data.privacyDialogVisible
    ) {
      return;
    }
    const request = ++runtime.request;
    this.setData({
      pendingSource: source,
      errorMessage: "",
      canOpenSettings: false,
    });

    if (typeof wx.getPrivacySetting !== "function") {
      void this.chooseAndPrepare(source, runtime, request);
      return;
    }

    wx.getPrivacySetting({
      success: ({ needAuthorization }) => {
        if (!isEntryRequestActive(this, runtime, request)) {
          return;
        }
        if (needAuthorization) {
          this.setData({ privacyDialogVisible: true });
          return;
        }
        void this.chooseAndPrepare(source, runtime, request);
      },
      fail: () => {
        if (!isEntryRequestActive(this, runtime, request)) {
          return;
        }
        this.setData({
          pendingSource: null,
          errorMessage: "暂时无法确认隐私授权状态，请稍后重试。",
        });
      },
    });
  },

  onAgreePrivacyAuthorization() {
    const runtime = entryPageRuntimes.get(this);
    if (runtime === undefined || !isEntryPageActive(this, runtime)) {
      return;
    }
    const request = runtime.request;
    const source = this.data.pendingSource;
    this.setData({ privacyDialogVisible: false });
    if (source !== null) {
      void this.chooseAndPrepare(source, runtime, request);
    }
  },

  onCancelPrivacy() {
    const runtime = entryPageRuntimes.get(this);
    if (runtime === undefined || !isEntryPageActive(this, runtime)) {
      return;
    }
    runtime.request += 1;
    this.setData({
      privacyDialogVisible: false,
      pendingSource: null,
    });
  },

  onBlockTouch() {},

  async chooseAndPrepare(
    source: MediaSource,
    runtime: EntryPageRuntime,
    request: number,
  ) {
    if (!isEntryRequestActive(this, runtime, request)) {
      return;
    }
    this.setData({
      isBusy: true,
      pendingSource: source,
      errorMessage: "",
      canOpenSettings: false,
    });

    const outcome = await mediaAdapter.chooseImage(source);
    if (!isEntryRequestActive(this, runtime, request)) {
      return;
    }
    if (outcome.kind === "cancelled") {
      this.setData({ isBusy: false, pendingSource: null });
      return;
    }
    if (outcome.kind === "error") {
      this.setData({
        isBusy: false,
        pendingSource: null,
        errorMessage: outcome.error.message,
        canOpenSettings: outcome.error.canOpenSettings,
      });
      return;
    }

    let generatedPreview: string | null = null;
    let selectedIdentity: SessionImageIdentity | null = null;
    try {
      const identity = await appSessionRuntime.selectImage(
        outcome.image,
        async () => {
          if (generatedPreview !== null) {
            await removeGeneratedFile(generatedPreview);
          }
        },
      );
      selectedIdentity = identity;
      if (!isEntryRequestActive(this, runtime, request)) {
        await clearStaleSelection(identity, generatedPreview);
        return;
      }
      const selectedSnapshot = appSessionStore.getSnapshot();
      const image = selectedSnapshot.image;
      if (image === null || !matchesIdentity(selectedSnapshot, identity)) {
        throw new Error("The selected image session was not created");
      }

      const materialized = await this.materializeImage(
        outcome.image,
        image.analysisPlan,
        identity,
      );
      generatedPreview = materialized.previewRef;
      if (!isEntryRequestActive(this, runtime, request)) {
        await clearStaleSelection(identity, generatedPreview);
        return;
      }
      if (
        !appSessionRuntime.materializeImage(
          identity,
          materialized.fixedImage,
          materialized.previewRef,
        )
      ) {
        await removeGeneratedFile(materialized.previewRef);
        generatedPreview = null;
        throw new Error("The selected image changed during preparation");
      }

      if (!isEntryRequestActive(this, runtime, request)) {
        await clearStaleSelection(identity, generatedPreview);
        return;
      }
      runtime.navigationBusy = true;
      wx.navigateTo({
        url: "/pages/sample/index",
        fail: () => {
          if (!isEntryRequestActive(this, runtime, request)) {
            return;
          }
          runtime.navigationBusy = false;
          this.setData({
            isBusy: false,
            pendingSource: null,
            errorMessage: "无法打开取样页，请重试。",
          });
        },
      });
    } catch (_error) {
      const current = appSessionStore.getSnapshot();
      if (
        selectedIdentity !== null &&
        matchesIdentity(current, selectedIdentity)
      ) {
        await appSessionStore.restart();
      }
      if (!isEntryRequestActive(this, runtime, request)) {
        return;
      }
      this.setData({
        isBusy: false,
        pendingSource: null,
        errorMessage: "图片无法读取，请重新选择其他图片。",
        canOpenSettings: false,
      });
    }
  },

  async materializeImage(
    source: ChosenImage,
    plan: AnalysisImagePlan,
    identity: SessionImageIdentity,
  ): Promise<MaterializedCanvasImage> {
    const canvas = await this.getNormalizationCanvas();
    let context: WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D | null = null;
    try {
      canvas.width = plan.width;
      canvas.height = plan.height;
      const activeContext = canvas.getContext("2d");
      context = activeContext;
      activeContext.setTransform(1, 0, 0, 1, 0, 0);
      activeContext.clearRect(0, 0, plan.width, plan.height);

      const canvasImage = canvas.createImage();
      await new Promise<void>((resolve, reject) => {
        canvasImage.onload = () => resolve();
        canvasImage.onerror = () => reject(new Error("Image decoding failed"));
        canvasImage.src = source.tempFilePath;
      });
      if (
        canvasImage.width !== plan.sourceWidth ||
        canvasImage.height !== plan.sourceHeight
      ) {
        throw new Error("Decoded image dimensions changed during preparation");
      }

      const { a, b, c, d, e, f } = plan.transform;
      activeContext.setTransform(a, b, c, d, e, f);
      activeContext.drawImage(
        canvasImage,
        0,
        0,
        plan.sourceWidth,
        plan.sourceHeight,
      );
      activeContext.setTransform(1, 0, 0, 1, 0, 0);

      const pixels = activeContext.getImageData(0, 0, plan.width, plan.height);
      const fixedPixels = new Uint8ClampedArray(pixels.data);
      const previewRef = await exportCanvas(canvas, plan.width, plan.height, this);
      return {
        fixedImage: {
          width: plan.width,
          height: plan.height,
          data: fixedPixels,
          sourceImageVersion: identity.imageVersion,
          plan,
        },
        previewRef,
      };
    } finally {
      try {
        context?.setTransform(1, 0, 0, 1, 0, 0);
        context?.clearRect(0, 0, canvas.width, canvas.height);
      } catch (_cleanupError) {
        // Best effort: the backing store is also reset below.
      }
      try {
        canvas.width = 1;
        canvas.height = 1;
      } catch (_cleanupError) {
        // Canvas teardown must not mask the original image error.
      }
    }
  },

  getNormalizationCanvas(): Promise<WechatMiniprogram.Canvas> {
    return new Promise((resolve, reject) => {
      this.createSelectorQuery()
        .select("#normalizationCanvas")
        .fields({ node: true })
        .exec((results) => {
          const canvas = (results[0] as CanvasNodeResult | undefined)?.node;
          if (canvas === undefined) {
            reject(new Error("Canvas is unavailable"));
            return;
          }
          resolve(canvas);
        });
    });
  },

  onOpenSettings() {
    const runtime = entryPageRuntimes.get(this);
    if (runtime === undefined || !isEntryPageActive(this, runtime)) {
      return;
    }
    const request = runtime.request;
    wx.openSetting({
      fail: () => {
        if (!isEntryRequestActive(this, runtime, request)) {
          return;
        }
        this.setData({
          errorMessage: "无法打开设置，请在微信设置中允许相机或相册权限。",
          canOpenSettings: false,
        });
      },
    });
  },
});

function isEntryPageActive(page: object, runtime: EntryPageRuntime): boolean {
  return runtime.alive && entryPageRuntimes.get(page) === runtime;
}

function isEntryRequestActive(
  page: object,
  runtime: EntryPageRuntime,
  request: number,
): boolean {
  return isEntryPageActive(page, runtime) && runtime.request === request;
}

async function clearStaleSelection(
  identity: SessionImageIdentity,
  generatedPreview: string | null,
): Promise<void> {
  if (matchesIdentity(appSessionStore.getSnapshot(), identity)) {
    await appSessionStore.restart();
    return;
  }
  if (generatedPreview !== null) {
    await removeGeneratedFile(generatedPreview);
  }
}

function matchesIdentity(
  snapshot: ReturnType<typeof appSessionStore.getSnapshot>,
  identity: SessionImageIdentity,
): boolean {
  return (
    snapshot.sessionId === identity.sessionId &&
    snapshot.revision === identity.revision &&
    snapshot.imageVersion === identity.imageVersion
  );
}

function exportCanvas(
  canvas: WechatMiniprogram.Canvas,
  width: number,
  height: number,
  page: WechatMiniprogram.Page.Instance<EntryPageData, WechatMiniprogram.Page.CustomOption>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath(
      {
        canvas: canvas as unknown as WechatMiniprogram.IAnyObject,
        x: 0,
        y: 0,
        width,
        height,
        destWidth: width,
        destHeight: height,
        fileType: "png",
        success: ({ tempFilePath }) => resolve(tempFilePath),
        fail: () => reject(new Error("Canvas export failed")),
      },
      page,
    );
  });
}

function removeGeneratedFile(filePath: string): Promise<void> {
  return new Promise((resolve) => {
    wx.getFileSystemManager().unlink({
      filePath,
      success: () => resolve(),
      fail: () => resolve(),
    });
  });
}
