import type {
  AnalysisImageMaterializationErrorKind,
  AnalysisImagePlan,
  AnalysisPixelSource,
  ChosenImage,
  FixedAnalysisImage,
  WeChatCanvasImage,
  WeChatOffscreenCanvasApi,
} from "./types";

export class AnalysisImageMaterializationError extends Error {
  constructor(
    readonly kind: AnalysisImageMaterializationErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "AnalysisImageMaterializationError";
  }
}

export class WeChatOffscreenAnalysisPixelSource implements AnalysisPixelSource {
  constructor(private readonly api: WeChatOffscreenCanvasApi | null) {}

  async materialize(
    image: ChosenImage,
    plan: AnalysisImagePlan,
    sourceImageVersion: string,
  ): Promise<FixedAnalysisImage> {
    assertMaterializationInput(image, plan, sourceImageVersion);
    if (this.api === null) {
      throw new AnalysisImageMaterializationError(
        "api_unavailable",
        "当前环境无法创建离屏分析画布。",
      );
    }

    try {
      const canvas = this.api.createOffscreenCanvas({
        type: "2d",
        width: plan.width,
        height: plan.height,
      });
      if (canvas.width !== plan.width || canvas.height !== plan.height) {
        throw new AnalysisImageMaterializationError(
          "runtime_failed",
          "离屏画布尺寸与分析图像计划不一致。",
        );
      }
      const context = canvas.getContext("2d");
      if (context === null) {
        throw new AnalysisImageMaterializationError(
          "runtime_failed",
          "无法获取离屏画布的 2D 上下文。",
        );
      }

      const decodedImage = canvas.createImage();
      await loadImage(decodedImage, image.tempFilePath);
      if (
        decodedImage.width !== plan.sourceWidth ||
        decodedImage.height !== plan.sourceHeight
      ) {
        throw new AnalysisImageMaterializationError(
          "decode_failed",
          "解码后的图片尺寸与已选择图片不一致。",
        );
      }

      const { a, b, c, d, e, f } = plan.transform;
      context.setTransform(a, b, c, d, e, f);
      context.drawImage(
        decodedImage,
        0,
        0,
        plan.sourceWidth,
        plan.sourceHeight,
      );
      const imageData = context.getImageData(0, 0, plan.width, plan.height);
      const data = new Uint8ClampedArray(imageData.data);
      if (
        imageData.width !== plan.width ||
        imageData.height !== plan.height ||
        data.length !== plan.width * plan.height * 4
      ) {
        throw new AnalysisImageMaterializationError(
          "runtime_failed",
          "离屏画布返回了无效的像素数据。",
        );
      }

      return Object.freeze({
        width: plan.width,
        height: plan.height,
        data,
        sourceImageVersion,
        plan,
      });
    } catch (error) {
      if (error instanceof AnalysisImageMaterializationError) {
        throw error;
      }
      throw new AnalysisImageMaterializationError(
        "runtime_failed",
        "无法生成固定分析图像。",
      );
    }
  }

  dispose(): void {
    // Canvas, decoded image, and source pixels are scoped to materialize().
  }
}

function loadImage(image: WeChatCanvasImage, src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const clearCallbacks = () => {
      image.onload = () => undefined;
      image.onerror = () => undefined;
    };
    image.onload = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearCallbacks();
      resolve();
    };
    image.onerror = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearCallbacks();
      reject(
        new AnalysisImageMaterializationError(
          "decode_failed",
          "图片无法解码，请重新选择其他图片。",
        ),
      );
    };
    image.src = src;
  });
}

function assertMaterializationInput(
  image: ChosenImage,
  plan: AnalysisImagePlan,
  sourceImageVersion: string,
): void {
  const transformValues = Object.values(plan.transform);
  if (
    !sourceImageVersion.trim() ||
    !image.tempFilePath.trim() ||
    plan.sourceWidth !== image.width ||
    plan.sourceHeight !== image.height ||
    plan.sourceOrientation !== image.orientation ||
    !Number.isInteger(plan.width) ||
    plan.width <= 0 ||
    !Number.isInteger(plan.height) ||
    plan.height <= 0 ||
    transformValues.some((value) => !Number.isFinite(value))
  ) {
    throw new AnalysisImageMaterializationError(
      "invalid_plan",
      "分析图像计划与当前图片不一致。",
    );
  }
}

const appOffscreenCanvasApi: WeChatOffscreenCanvasApi | null =
  typeof wx === "undefined" || typeof wx.createOffscreenCanvas !== "function"
    ? null
    : {
        createOffscreenCanvas: (options) =>
          wx.createOffscreenCanvas(options) as unknown as ReturnType<
            WeChatOffscreenCanvasApi["createOffscreenCanvas"]
          >,
      };

export const appAnalysisPixelSource =
  new WeChatOffscreenAnalysisPixelSource(appOffscreenCanvasApi);
