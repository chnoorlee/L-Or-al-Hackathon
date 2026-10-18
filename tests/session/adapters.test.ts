import { describe, expect, it } from "vitest";
import type { CommerceRoute } from "../../miniprogram/core";
import {
  DisabledCommerceAdapter,
  NullInferenceAdapter,
  VerifiedWeChatCommerceAdapter,
  WeChatOffscreenAnalysisPixelSource,
  WeChatMediaAdapter,
  classifyMediaFailure,
  createAnalysisImagePlan,
  type ImageOrientation,
  type WeChatCanvas2DContext,
  type WeChatCanvasImage,
  type WeChatOffscreenCanvas,
  type WeChatOffscreenCanvasApi,
  type WeChatCommerceApi,
  type WeChatMediaApi,
} from "../../miniprogram/adapters";

const verifiedRoute: CommerceRoute = {
  kind: "mini_program",
  verifiedAt: "2026-10-15",
  productId: "product-1",
  skuId: "sku-1",
  appId: "wx-verified-app",
  path: "pages/product/index?sku=sku-1",
  url: null,
  skuPreselectVerified: true,
  deviceEvidenceRef: "device-check-1",
};

describe("WeChatMediaAdapter", () => {
  it("selects one image and reads authoritative dimensions and orientation", async () => {
    let capturedSource: string | undefined;
    const api: WeChatMediaApi = {
      chooseMedia(options) {
        expect(options.count).toBe(1);
        expect(options.mediaType).toEqual(["image"]);
        expect(options.sourceType).toEqual(["camera"]);
        options.success({
          tempFiles: [{ tempFilePath: "wxfile://photo.jpg", size: 1234 }],
        });
      },
      getImageInfo(options) {
        capturedSource = options.src;
        options.success({
          width: 4032,
          height: 3024,
          orientation: "right",
          type: "JPG",
        });
      },
    };

    await expect(new WeChatMediaAdapter(api).chooseImage("camera")).resolves.toEqual({
      kind: "selected",
      image: {
        tempFilePath: "wxfile://photo.jpg",
        size: 1234,
        width: 4032,
        height: 3024,
        orientation: "right",
        format: "jpg",
      },
    });
    expect(capturedSource).toBe("wxfile://photo.jpg");
  });

  it("distinguishes cancellation, permissions, unavailable APIs, and decode failures", async () => {
    expect(
      classifyMediaFailure({ errMsg: "chooseMedia:fail cancel" }, "choose"),
    ).toBe("cancelled");
    expect(
      classifyMediaFailure({ errMsg: "chooseMedia:fail auth deny" }, "choose"),
    ).toMatchObject({ kind: "permission_denied", canOpenSettings: true });
    expect(
      classifyMediaFailure({ errMsg: "not supported" }, "choose"),
    ).toMatchObject({ kind: "api_unavailable" });
    expect(
      classifyMediaFailure({ errMsg: "decode error" }, "decode"),
    ).toMatchObject({ kind: "decode_failed" });

    await expect(new WeChatMediaAdapter(null).chooseImage("album")).resolves.toMatchObject({
      kind: "error",
      error: { kind: "api_unavailable" },
    });

    const cancelledApi: WeChatMediaApi = {
      chooseMedia(options) {
        options.fail({ errMsg: "chooseMedia:fail cancel" });
      },
      getImageInfo() {
        throw new Error("must not decode after cancellation");
      },
    };
    await expect(
      new WeChatMediaAdapter(cancelledApi).chooseImage("album"),
    ).resolves.toEqual({ kind: "cancelled" });
  });

  it("normalizes synchronous platform exceptions and rejects fractional dimensions", async () => {
    const chooseThrows: WeChatMediaApi = {
      chooseMedia() {
        throw { errMsg: "chooseMedia:fail auth deny" };
      },
      getImageInfo() {
        throw new Error("must not decode");
      },
    };
    await expect(
      new WeChatMediaAdapter(chooseThrows).chooseImage("camera"),
    ).resolves.toMatchObject({
      kind: "error",
      error: { kind: "permission_denied" },
    });

    const decodeThrows: WeChatMediaApi = {
      chooseMedia(options) {
        options.success({ tempFiles: [{ tempFilePath: "wxfile://photo.jpg" }] });
      },
      getImageInfo() {
        throw new Error("decoder crashed");
      },
    };
    await expect(
      new WeChatMediaAdapter(decodeThrows).chooseImage("album"),
    ).resolves.toMatchObject({
      kind: "error",
      error: { kind: "decode_failed" },
    });

    const fractionalDimensions: WeChatMediaApi = {
      chooseMedia(options) {
        options.success({ tempFiles: [{ tempFilePath: "wxfile://photo.jpg" }] });
      },
      getImageInfo(options) {
        options.success({ width: 4.5, height: 3 });
      },
    };
    await expect(
      new WeChatMediaAdapter(fractionalDimensions).chooseImage("album"),
    ).resolves.toMatchObject({
      kind: "error",
      error: { kind: "invalid_response" },
    });
  });

  it.each([undefined, "future-orientation"])(
    "rejects an unverified image orientation: %s",
    async (orientation) => {
      const api: WeChatMediaApi = {
        chooseMedia(options) {
          options.success({ tempFiles: [{ tempFilePath: "wxfile://photo.jpg" }] });
        },
        getImageInfo(options) {
          options.success({ width: 4, height: 3, orientation });
        },
      };

      await expect(new WeChatMediaAdapter(api).chooseImage("album")).resolves.toEqual({
        kind: "error",
        error: {
          kind: "invalid_response",
          message: "图片方向无法确认，请换一张图片。",
          canOpenSettings: false,
        },
      });
    },
  );
});

describe("analysis image planning", () => {
  const expected = new Map<ImageOrientation, readonly number[]>([
    ["up", [1, 0, 0, 1, 0, 0]],
    ["up-mirrored", [-1, 0, 0, 1, 4, 0]],
    ["down", [-1, 0, 0, -1, 4, 3]],
    ["down-mirrored", [1, 0, 0, -1, 0, 3]],
    ["left-mirrored", [0, 1, 1, 0, 0, 0]],
    ["right", [0, 1, -1, 0, 3, 0]],
    ["right-mirrored", [0, -1, -1, 0, 3, 4]],
    ["left", [0, -1, 1, 0, 0, 4]],
  ]);

  it("maps all eight EXIF orientations into the canonical canvas", () => {
    for (const [orientation, matrix] of expected) {
      const plan = createAnalysisImagePlan(
        { width: 4, height: 3, orientation },
        1280,
      );
      expect([
        plan.transform.a,
        plan.transform.b,
        plan.transform.c,
        plan.transform.d,
        plan.transform.e,
        plan.transform.f,
      ]).toEqual(matrix);
      expect([plan.width, plan.height]).toEqual(
        ["left-mirrored", "right", "right-mirrored", "left"].includes(
          orientation,
        )
          ? [3, 4]
          : [4, 3],
      );
      expect(plan.orientationKnown).toBe(true);
    }
  });

  it("contains without upscaling and exposes unknown orientation explicitly", () => {
    const rotated = createAnalysisImagePlan(
      { width: 4000, height: 3000, orientation: "right" },
      1280,
    );
    expect([rotated.width, rotated.height]).toEqual([960, 1280]);
    expect(rotated.transform).toEqual({
      a: 0,
      b: 0.32,
      c: -0.32,
      d: 0,
      e: 960,
      f: 0,
    });

    const small = createAnalysisImagePlan(
      { width: 20, height: 10, orientation: "unknown" },
      1280,
    );
    expect([small.width, small.height]).toEqual([20, 10]);
    expect(small.orientationKnown).toBe(false);
    expect(small.transform).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  });
});

describe("WeChatOffscreenAnalysisPixelSource", () => {
  class FakeImage implements WeChatCanvasImage {
    width = 4;
    height = 3;
    onload = () => undefined;
    onerror = () => undefined;
    private currentSrc = "";

    constructor(private readonly failDecode = false) {}

    get src(): string {
      return this.currentSrc;
    }

    set src(value: string) {
      this.currentSrc = value;
      queueMicrotask(() => {
        if (this.failDecode) {
          this.onerror();
        } else {
          this.onload();
        }
      });
    }
  }

  it("draws once with the planned transform and returns an independent RGBA copy", async () => {
    const plan = createAnalysisImagePlan(
      { width: 4, height: 3, orientation: "right" },
      1280,
    );
    const canvasPixels = new Uint8ClampedArray(plan.width * plan.height * 4);
    canvasPixels[0] = 17;
    const transforms: number[][] = [];
    let drawCount = 0;
    const context: WeChatCanvas2DContext = {
      setTransform: (...values) => transforms.push(values),
      drawImage: () => {
        drawCount += 1;
      },
      getImageData: () => ({
        data: canvasPixels,
        width: plan.width,
        height: plan.height,
      }),
    };
    const canvas: WeChatOffscreenCanvas = {
      width: plan.width,
      height: plan.height,
      createImage: () => new FakeImage(),
      getContext: () => context,
    };
    const api: WeChatOffscreenCanvasApi = {
      createOffscreenCanvas(options) {
        expect(options).toEqual({ type: "2d", width: 3, height: 4 });
        return canvas;
      },
    };

    const result = await new WeChatOffscreenAnalysisPixelSource(api).materialize(
      {
        tempFilePath: "wxfile://source.jpg",
        size: 100,
        width: 4,
        height: 3,
        orientation: "right",
        format: "jpg",
      },
      plan,
      "image-1",
    );

    expect(transforms).toEqual([[0, 1, -1, 0, 3, 0]]);
    expect(drawCount).toBe(1);
    expect(result).toMatchObject({
      width: 3,
      height: 4,
      sourceImageVersion: "image-1",
      plan,
    });
    expect(result.data).not.toBe(canvasPixels);
    expect(result.data[0]).toBe(17);
    canvasPixels[0] = 91;
    expect(result.data[0]).toBe(17);
  });

  it("classifies unavailable, decode, and canvas runtime failures", async () => {
    const image = {
      tempFilePath: "wxfile://source.jpg",
      size: null,
      width: 4,
      height: 3,
      orientation: "up" as const,
      format: "jpg",
    };
    const plan = createAnalysisImagePlan(image, 1280);

    await expect(
      new WeChatOffscreenAnalysisPixelSource(null).materialize(
        image,
        plan,
        "image-1",
      ),
    ).rejects.toMatchObject({ kind: "api_unavailable" });

    const decodeApi: WeChatOffscreenCanvasApi = {
      createOffscreenCanvas: () => ({
        width: plan.width,
        height: plan.height,
        createImage: () => new FakeImage(true),
        getContext: () => ({
          setTransform: () => undefined,
          drawImage: () => undefined,
          getImageData: () => ({ data: [], width: 4, height: 3 }),
        }),
      }),
    };
    await expect(
      new WeChatOffscreenAnalysisPixelSource(decodeApi).materialize(
        image,
        plan,
        "image-1",
      ),
    ).rejects.toMatchObject({ kind: "decode_failed" });

    const runtimeApi: WeChatOffscreenCanvasApi = {
      createOffscreenCanvas: () => ({
        width: plan.width,
        height: plan.height,
        createImage: () => new FakeImage(),
        getContext: () => null,
      }),
    };
    await expect(
      new WeChatOffscreenAnalysisPixelSource(runtimeApi).materialize(
        image,
        plan,
        "image-1",
      ),
    ).rejects.toMatchObject({ kind: "runtime_failed" });
  });
});

describe("optional adapters", () => {
  it("keeps inference unavailable without a configured model", async () => {
    const adapter = new NullInferenceAdapter<string>();
    await expect(adapter.suggest("local-image")).resolves.toEqual({
      kind: "unavailable",
      reason: "not_configured",
    });
    expect(adapter.dispose()).toBeUndefined();
  });

  it("keeps commerce disabled until a verified route and API are available", async () => {
    await expect(
      new DisabledCommerceAdapter().openFromUserGesture(verifiedRoute),
    ).resolves.toEqual({ kind: "unavailable", reason: "not_configured" });
    await expect(
      new VerifiedWeChatCommerceAdapter(null).openFromUserGesture(verifiedRoute),
    ).resolves.toEqual({ kind: "unavailable", reason: "api_unavailable" });
  });

  it("opens only the verified mini-program route and classifies cancellation", async () => {
    let openedPath: string | undefined;
    const successApi: WeChatCommerceApi = {
      navigateToMiniProgram(options) {
        expect(options.appId).toBe("wx-verified-app");
        openedPath = options.path;
        options.success();
      },
    };
    await expect(
      new VerifiedWeChatCommerceAdapter(successApi).openFromUserGesture(
        verifiedRoute,
      ),
    ).resolves.toEqual({ kind: "opened" });
    expect(openedPath).toBe("pages/product/index?sku=sku-1");

    const cancelApi: WeChatCommerceApi = {
      navigateToMiniProgram(options) {
        options.fail({ errMsg: "navigateToMiniProgram:fail cancel" });
      },
    };
    await expect(
      new VerifiedWeChatCommerceAdapter(cancelApi).openFromUserGesture(
        verifiedRoute,
      ),
    ).resolves.toEqual({ kind: "cancelled" });

    await expect(
      new VerifiedWeChatCommerceAdapter(successApi).openFromUserGesture({
        ...verifiedRoute,
        path: null,
      }),
    ).resolves.toEqual({ kind: "failed", reason: "invalid_verified_route" });

    await expect(
      new VerifiedWeChatCommerceAdapter(successApi).openFromUserGesture({
        ...verifiedRoute,
        skuPreselectVerified: false,
      }),
    ).resolves.toEqual({ kind: "opened" });
    await expect(
      new VerifiedWeChatCommerceAdapter(successApi).openFromUserGesture({
        ...verifiedRoute,
        verifiedAt: "2026-02-31",
      }),
    ).resolves.toEqual({ kind: "failed", reason: "invalid_verified_route" });

    const throwingApi: WeChatCommerceApi = {
      navigateToMiniProgram() {
        throw new Error("platform failure");
      },
    };
    await expect(
      new VerifiedWeChatCommerceAdapter(throwingApi).openFromUserGesture(
        verifiedRoute,
      ),
    ).resolves.toEqual({ kind: "failed", reason: "navigation_failed" });
  });
});
