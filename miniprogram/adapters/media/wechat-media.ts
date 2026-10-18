import type {
  ImageOrientation,
  MediaAdapter,
  MediaAdapterError,
  MediaSelectionOutcome,
  MediaSource,
  WeChatFailure,
  WeChatImageInfoResult,
  WeChatMediaApi,
} from "./types";

type MediaOperation = "choose" | "decode";

const orientations = new Set<ImageOrientation>([
  "up",
  "up-mirrored",
  "down",
  "down-mirrored",
  "left-mirrored",
  "right",
  "right-mirrored",
  "left",
]);

export function classifyMediaFailure(
  failure: WeChatFailure,
  operation: MediaOperation,
): "cancelled" | MediaAdapterError {
  const detail = failure.errMsg?.toLowerCase() ?? "";
  if (detail.includes("cancel")) {
    return "cancelled";
  }
  if (
    detail.includes("auth deny") ||
    detail.includes("auth denied") ||
    detail.includes("permission") ||
    detail.includes("authorize:fail")
  ) {
    return {
      kind: "permission_denied",
      message: "需要相机或相册权限才能选择图片。",
      canOpenSettings: true,
    };
  }
  if (detail.includes("not supported") || detail.includes("not available")) {
    return {
      kind: "api_unavailable",
      message: "当前微信版本或设备暂不支持该取图方式。",
      canOpenSettings: false,
    };
  }
  return operation === "decode"
    ? {
        kind: "decode_failed",
        message: "图片无法读取，请重新选择其他图片。",
        canOpenSettings: false,
      }
    : {
        kind: "unknown",
        message: "暂时无法选择图片，请重试。",
        canOpenSettings: false,
      };
}

export class WeChatMediaAdapter implements MediaAdapter {
  constructor(private readonly api: WeChatMediaApi | null) {}

  async chooseImage(source: MediaSource): Promise<MediaSelectionOutcome> {
    if (this.api === null) {
      return {
        kind: "error",
        error: {
          kind: "api_unavailable",
          message: "当前环境无法调用微信媒体能力。",
          canOpenSettings: false,
        },
      };
    }

    const api = this.api;
    return new Promise((resolve) => {
      try {
        api.chooseMedia({
          count: 1,
          mediaType: ["image"],
          sourceType: [source],
          success: (result) => {
            const file = result.tempFiles?.[0];
            if (file?.tempFilePath === undefined || !file.tempFilePath.trim()) {
              resolve({
                kind: "error",
                error: {
                  kind: "invalid_response",
                  message: "未读取到有效图片，请重新选择。",
                  canOpenSettings: false,
                },
              });
              return;
            }
            this.readImageInfo(api, file.tempFilePath, file.size, resolve);
          },
          fail: (failure) => {
            resolveClassifiedFailure(resolve, failure, "choose");
          },
        });
      } catch (error) {
        resolveClassifiedFailure(resolve, failureFromUnknown(error), "choose");
      }
    });
  }

  private readImageInfo(
    api: WeChatMediaApi,
    tempFilePath: string,
    size: number | undefined,
    resolve: (outcome: MediaSelectionOutcome) => void,
  ): void {
    try {
      api.getImageInfo({
        src: tempFilePath,
        success: (info) => {
          if (!isValidImageInfo(info)) {
            resolve({
              kind: "error",
              error: {
                kind: "invalid_response",
                message: "图片尺寸信息无效，请重新选择。",
                canOpenSettings: false,
              },
            });
            return;
          }
          const orientation = normalizeOrientation(info.orientation);
          if (orientation === "unknown") {
            resolve({
              kind: "error",
              error: {
                kind: "invalid_response",
                message: "图片方向无法确认，请换一张图片。",
                canOpenSettings: false,
              },
            });
            return;
          }
          resolve({
            kind: "selected",
            image: {
              tempFilePath,
              size:
                Number.isFinite(size) && (size ?? 0) >= 0 ? size ?? null : null,
              width: info.width,
              height: info.height,
              orientation,
              format: info.type?.trim().toLowerCase() || null,
            },
          });
        },
        fail: (failure) => {
          resolveClassifiedFailure(resolve, failure, "decode");
        },
      });
    } catch (error) {
      resolveClassifiedFailure(resolve, failureFromUnknown(error), "decode");
    }
  }
}

function resolveClassifiedFailure(
  resolve: (outcome: MediaSelectionOutcome) => void,
  failure: WeChatFailure,
  operation: MediaOperation,
): void {
  const classified = classifyMediaFailure(failure, operation);
  resolve(
    classified === "cancelled"
      ? { kind: "cancelled" }
      : { kind: "error", error: classified },
  );
}

function failureFromUnknown(error: unknown): WeChatFailure {
  if (
    typeof error === "object" &&
    error !== null &&
    "errMsg" in error &&
    typeof error.errMsg === "string"
  ) {
    return { errMsg: error.errMsg };
  }
  return error instanceof Error ? { errMsg: error.message } : {};
}

export const appMediaAdapter = new WeChatMediaAdapter(
  typeof wx === "undefined" ? null : wx,
);

function isValidImageInfo(
  info: WeChatImageInfoResult,
): info is WeChatImageInfoResult & { width: number; height: number } {
  return (
    Number.isFinite(info.width) &&
    Number.isFinite(info.height) &&
    Number.isInteger(info.width) &&
    Number.isInteger(info.height) &&
    (info.width ?? 0) > 0 &&
    (info.height ?? 0) > 0
  );
}

function normalizeOrientation(value: string | undefined): ImageOrientation {
  const normalized = value?.trim().toLowerCase() as ImageOrientation | undefined;
  return normalized !== undefined && orientations.has(normalized)
    ? normalized
    : "unknown";
}

