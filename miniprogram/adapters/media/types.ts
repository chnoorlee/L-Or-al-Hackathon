import type { PixelBuffer } from "../../core/index";

export type MediaSource = "camera" | "album";

export type ImageOrientation =
  | "up"
  | "up-mirrored"
  | "down"
  | "down-mirrored"
  | "left-mirrored"
  | "right"
  | "right-mirrored"
  | "left"
  | "unknown";

export interface ChosenImage {
  readonly tempFilePath: string;
  readonly size: number | null;
  readonly width: number;
  readonly height: number;
  readonly orientation: ImageOrientation;
  readonly format: string | null;
}

/** Canvas 2D affine matrix: x' = a*x + c*y + e; y' = b*x + d*y + f. */
export interface CanvasTransform {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export interface AnalysisImagePlan {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly sourceOrientation: ImageOrientation;
  readonly orientationKnown: boolean;
  readonly orientedWidth: number;
  readonly orientedHeight: number;
  readonly width: number;
  readonly height: number;
  readonly transform: CanvasTransform;
}

/** The canonical, oriented RGBA buffer used for every ROI sample in a session. */
export interface FixedAnalysisImage extends PixelBuffer {
  readonly data: Uint8ClampedArray;
  readonly sourceImageVersion: string;
  readonly plan: AnalysisImagePlan;
}

/** Page-bound Canvas implementations can satisfy this without exposing wx to core logic. */
export interface AnalysisPixelSource {
  materialize(
    image: ChosenImage,
    plan: AnalysisImagePlan,
    sourceImageVersion: string,
  ): Promise<FixedAnalysisImage>;
  dispose(): void | Promise<void>;
}

export type AnalysisImageMaterializationErrorKind =
  | "api_unavailable"
  | "decode_failed"
  | "invalid_plan"
  | "runtime_failed";

export interface WeChatCanvasImage {
  width: number;
  height: number;
  src: string;
  onload: () => void;
  onerror: () => void;
}

export interface WeChatCanvasImageData {
  readonly data: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
}

export interface WeChatCanvas2DContext {
  setTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void;
  drawImage(
    image: WeChatCanvasImage,
    dx: number,
    dy: number,
    width: number,
    height: number,
  ): void;
  getImageData(
    x: number,
    y: number,
    width: number,
    height: number,
  ): WeChatCanvasImageData;
}

export interface WeChatOffscreenCanvas {
  readonly width: number;
  readonly height: number;
  createImage(): WeChatCanvasImage;
  getContext(type: "2d"): WeChatCanvas2DContext | null;
}

export interface WeChatOffscreenCanvasApi {
  createOffscreenCanvas(options: {
    readonly type: "2d";
    readonly width: number;
    readonly height: number;
  }): WeChatOffscreenCanvas;
}

export type MediaErrorKind =
  | "permission_denied"
  | "api_unavailable"
  | "decode_failed"
  | "invalid_response"
  | "unknown";

export interface MediaAdapterError {
  readonly kind: MediaErrorKind;
  readonly message: string;
  readonly canOpenSettings: boolean;
}

export type MediaSelectionOutcome =
  | { readonly kind: "selected"; readonly image: ChosenImage }
  | { readonly kind: "cancelled" }
  | { readonly kind: "error"; readonly error: MediaAdapterError };

export interface MediaAdapter {
  chooseImage(source: MediaSource): Promise<MediaSelectionOutcome>;
}

export interface WeChatFailure {
  readonly errMsg?: string;
}

export interface WeChatChooseMediaResult {
  readonly tempFiles?: readonly {
    readonly tempFilePath?: string;
    readonly size?: number;
  }[];
}

export interface WeChatImageInfoResult {
  readonly width?: number;
  readonly height?: number;
  readonly orientation?: string;
  readonly type?: string;
}

export interface WeChatMediaApi {
  chooseMedia(options: {
    readonly count: 1;
    readonly mediaType: ["image"];
    readonly sourceType: [MediaSource];
    readonly success: (result: WeChatChooseMediaResult) => void;
    readonly fail: (error: WeChatFailure) => void;
  }): void;
  getImageInfo(options: {
    readonly src: string;
    readonly success: (result: WeChatImageInfoResult) => void;
    readonly fail: (error: WeChatFailure) => void;
  }): void;
}

