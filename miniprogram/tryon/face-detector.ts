import type { PixelBuffer } from "../core/types";
import { resizeForPreview } from "./engine";

export type FaceAnchor = Pick<WechatMiniprogram.VKFaceAnchor, "points" | "confidence" | "origin" | "size">;
type Frame = PixelBuffer & { data: Uint8ClampedArray };
export interface FaceDetection { anchors: FaceAnchor[]; frame: Frame; capturedAt: number }

// Only expose documented numeric codes, never native exception payloads or image data.
function nativeFailure(error: unknown): string {
  const value = typeof error === "object" && error !== null && "errCode" in error ? error.errCode : error;
  const code = typeof value === "number" && Number.isSafeInteger(value) ? value : null;
  const reasons: Record<number, string> = {
    104: "人脸跟踪授权被取消，请重试并允许授权。",
    112: "小程序尚未声明人脸跟踪所需的隐私接口，需要开发者补充配置。",
    1025: "人脸跟踪隐私接口暂不可用，需要开发者检查微信后台配置。",
    1026: "人脸跟踪隐私接口暂不可用，需要开发者检查微信后台配置。",
    2000001: "人脸跟踪参数未被微信接受。",
    2003000: "人脸跟踪会话暂不可用，请点击重试跟踪。",
    2000000: "微信人脸跟踪发生系统错误，请重试。",
    2000002: "当前环境不支持人脸跟踪，可尝试手机微信普通预览。",
    2000003: "当前系统不支持人脸跟踪，可尝试更新手机微信。",
    2000004: "当前环境不支持人脸跟踪，可尝试手机微信普通预览。",
    2003001: "请在手机系统设置中允许微信使用相机。",
    2003002: "请在微信设置中允许此小程序使用相机。",
  };
  return code === null ? "" : `（代码 ${code}）${reasons[code] || "请重试，或将此代码反馈给开发者。"}`;
}

/** One request in flight. A result always travels with the exact camera frame it describes. */
export class FaceDetector {
  private session: WechatMiniprogram.VKSession | null = null;
  private pending: { frame: Frame; capturedAt: number } | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private ready = false;
  private hasResult = false;
  private disposed = false;
  constructor(private readonly onResult: (result: FaceDetection) => void, private readonly onError: (message: string) => void) {}

  start() {
    if (this.disposed || this.session) return;
    try {
      if (typeof wx.createVKSession !== "function") { this.fail("当前微信没有提供人脸跟踪接口，请在手机微信普通预览中重试。"); return; }
      // Typings 5.2.3 incorrectly require plane even for the documented face-only mode.
      const track = { face: { mode: 2 } } as WechatMiniprogram.Track;
      const session = this.session = wx.createVKSession({ track, version: "v1" });
      session.on("addAnchors", this.receive);
      session.on("updateAnchors", this.receive);
      session.on("removeAnchors", this.remove);
      this.timer = setTimeout(() => this.fail("人脸跟踪启动超时。请重试，或切换局部遮瑕。"), 8000);
      session.start(error => {
        if (this.disposed || this.session !== session) return;
        clearTimeout(this.timer);
        if (error) { this.fail(`人脸跟踪启动失败${nativeFailure(error)}`); return; }
        this.ready = true;
      });
    } catch (error) { this.fail(`人脸跟踪初始化失败${nativeFailure(error) || "，请点击重试跟踪。"}`); }
  }

  submit(source: PixelBuffer, capturedAt: number): boolean {
    if (!this.ready || this.disposed || this.pending || !this.session) return false;
    // One bounded private copy. Results build masks, never replace the live video.
    const frame = resizeForPreview(source, 256);
    this.pending = { frame, capturedAt };
    // Native warmup may be slow; the motion tracker separately checks whether a
    // result can be aligned to the latest frame before displaying its mask.
    this.timer = setTimeout(() => this.fail(this.hasResult
      ? "人脸定位没有及时返回，已撤去妆效。请点击重试跟踪。"
      : "首次定位未返回，暂未生成妆效。请点击重试跟踪。"), this.hasResult ? 1200 : 8000);
    try {
      // Official documentation uses modelMode; published typings spell it modelModel.
      const options = { frameBuffer: frame.data.buffer as ArrayBuffer, width: frame.width, height: frame.height,
        scoreThreshold: .8, sourceType: 0 as const, modelMode: 1 };
      this.session.detectFace(options);
      return true;
    } catch (error) { this.fail(`人脸定位调用失败${nativeFailure(error) || "，请点击重试跟踪。"}`); return false; }
  }

  private receive = (anchors: FaceAnchor[]) => {
    const pending = this.pending;
    if (this.disposed || !pending) return;
    this.pending = null; this.hasResult = true; clearTimeout(this.timer);
    try { this.onResult({ anchors: Array.isArray(anchors) ? anchors : [], frame: pending.frame, capturedAt: pending.capturedAt }); }
    catch { this.fail("人脸画面处理失败，已撤去妆效。请重新开启相机。"); }
    finally { pending.frame.data.fill(0); }
  };
  // removeAnchors carries the removed face, which must not be painted as a result.
  private remove = () => { this.receive([]); };

  private fail(message: string) { if (!this.disposed) { this.dispose(); this.onError(message); } }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.ready = false; clearTimeout(this.timer);
    const session = this.session; this.session = null;
    for (const event of ["addAnchors", "updateAnchors", "removeAnchors"] as const) {
      try { session?.off(event, event === "removeAnchors" ? this.remove : this.receive); } catch { /* Native session may already be invalid. */ }
    }
    try { session?.destroy(); } catch { /* Clear private buffers even after a native failure. */ }
    this.pending?.frame.data.fill(0); this.pending = null;
  }
}
