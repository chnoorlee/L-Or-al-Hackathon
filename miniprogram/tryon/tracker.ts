import { srgbToLab } from "../core/color";
import type { LabColor, NormalizedCircle, PixelBuffer, Point, RgbColor } from "../core/types";
import { TryOnEngine, type RenderOptions } from "./engine";

const colorDistance = (a: LabColor, b: LabColor) => Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b);
function sample(image: PixelBuffer, circle: NormalizedCircle): RgbColor {
  const channels: number[][] = [[], [], []];
  const radius = circle.radius * Math.min(image.width, image.height);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const offset = (y * image.width + x) * 4;
    if (image.data[offset + 3] === 255 && Math.hypot(x + .5 - circle.x * image.width, y + .5 - circle.y * image.height) <= radius) {
      for (let c = 0; c < 3; c++) channels[c].push(image.data[offset + c]);
    }
  }
  if (channels[0].length < 9) throw new Error("取样范围太小，请靠近并重新取样。");
  const [r, g, b] = channels.map(values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]);
  return { r, g, b };
}
function centroid(mask: Uint8Array, width: number, height: number): Point {
  let x = 0, y = 0, count = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) { x += i % width + .5; y += Math.floor(i / width) + .5; count++; }
  return { x: x / count / width, y: y / count / height };
}

/** A bounded, local color-region tracker. No disease classifier or landmark model. */
export class RegionTracker {
  private coverLab: LabColor;
  private referenceLab: LabColor;
  private referenceRgb: RgbColor;
  private center: Point;
  private referenceOffset: Point;
  private baselineArea: number;
  private initial: TryOnEngine | null;
  private lost = false;
  private misses = 0;
  private recoveryHits = 0;
  private recoveryCenter: Point | null = null;
  private disposed = false;
  readonly width: number;
  readonly height: number;

  constructor(image: PixelBuffer, private readonly cover: NormalizedCircle, private readonly reference: NormalizedCircle) {
    if (image.width > 320 || image.height > 320 || image.data.length !== image.width * image.height * 4) throw new Error("实时画面尺寸无效。");
    if (Math.hypot((cover.x - reference.x) * image.width, (cover.y - reference.y) * image.height) <= (cover.radius + reference.radius) * Math.min(image.width, image.height)) throw new Error("A、B 取样范围不能重叠。");
    const coverRgb = sample(image, cover);
    this.referenceRgb = sample(image, reference);
    this.coverLab = srgbToLab(coverRgb); this.referenceLab = srgbToLab(this.referenceRgb);
    if (colorDistance(this.coverLab, this.referenceLab) < 8) throw new Error("两处颜色太接近，请重新选择 A、B。");
    this.width = image.width; this.height = image.height;
    this.initial = new TryOnEngine(image, cover, reference, this.coverLab, this.referenceLab, this.referenceRgb);
    const region = this.initial.segment(18, undefined, false, false);
    if (region.selectedPixels < 25 || region.selectedPixels > image.width * image.height * .5 || region.touchesEdge) {
      this.initial.dispose(); this.initial = null;
      throw new Error("选区太小、过大或触及画面边缘，请调整取景后重新校准。");
    }
    this.baselineArea = region.selectedPixels;
    this.center = centroid(this.initial.mask, image.width, image.height);
    this.referenceOffset = { x: reference.x - this.center.x, y: reference.y - this.center.y };
  }

  preview(options: RenderOptions): Uint8ClampedArray {
    if (!this.initial || this.disposed) throw new Error("Calibration cleared");
    return this.initial.render(options);
  }
  layer() { return this.initial?.layer() ?? null; }
  get expired() { return this.misses >= 20; }
  process(image: PixelBuffer, options?: RenderOptions): { status: "tracking" | "lost"; pixels: Uint8ClampedArray; center: Point } {
    if (this.disposed) throw new Error("Tracker cleared");
    if (image.width !== this.width || image.height !== this.height || image.data.length !== this.width * this.height * 4) {
      this.lost = true; this.misses = 20;
      return { status: "lost", pixels: Uint8ClampedArray.from(image.data), center: this.center };
    }
    this.initial?.dispose(); this.initial = null;
    const original = () => {
      this.misses++; this.recoveryHits = 0; this.recoveryCenter = null; this.lost = true;
      return { status: "lost" as const, pixels: options ? Uint8ClampedArray.from(image.data) : new Uint8ClampedArray(0), center: this.center };
    };
    if (this.expired) return original();
    // Search near the last accepted component, never across the whole frame.
    const radius = Math.min(this.width, this.height) * .12;
    const cx = this.center.x * this.width, cy = this.center.y * this.height;
    let best: Point | null = null, score = Infinity;
    for (let y = Math.max(0, Math.floor(cy - radius)); y < Math.min(this.height, cy + radius); y += 2) {
      for (let x = Math.max(0, Math.floor(cx - radius)); x < Math.min(this.width, cx + radius); x += 2) {
        const i = (y * this.width + x) * 4;
        if (image.data[i + 3] !== 255) continue;
        const lab = srgbToLab({ r: image.data[i], g: image.data[i + 1], b: image.data[i + 2] });
        const delta = colorDistance(lab, this.coverLab), displacement = Math.hypot(x - cx, y - cy);
        const candidateScore = delta + displacement / radius * 8;
        if (delta < 18 && delta + 2 < colorDistance(lab, this.referenceLab) && candidateScore < score) {
          score = candidateScore; best = { x: (x + .5) / this.width, y: (y + .5) / this.height };
        }
      }
    }
    if (!best) { this.lost = true; return original(); }
    const nextReference = { ...this.reference, x: this.center.x + this.referenceOffset.x, y: this.center.y + this.referenceOffset.y };
    if (nextReference.x < 0 || nextReference.x > 1 || nextReference.y < 0 || nextReference.y > 1) { this.lost = true; return original(); }
    let engine: TryOnEngine | null = null;
    try {
      engine = new TryOnEngine(image, { ...this.cover, ...best }, nextReference, this.coverLab, this.referenceLab, this.referenceRgb);
      const region = engine.segment(18, best, false, false);
      const center = centroid(engine.mask, this.width, this.height);
      const movement = Math.hypot((center.x - this.center.x) * this.width, (center.y - this.center.y) * this.height);
      if (region.selectedPixels < this.baselineArea * .45 || region.selectedPixels > this.baselineArea * 1.8 || region.touchesEdge || !Number.isFinite(movement) || movement > radius) {
        this.lost = true; return original();
      }
      const surroundingColor = sample(image, { ...nextReference, x: center.x + this.referenceOffset.x, y: center.y + this.referenceOffset.y });
      if (colorDistance(srgbToLab(surroundingColor), this.referenceLab) > 18) { this.lost = true; return original(); }
      // A short occlusion may recover only after two consistent, local detections.
      // Never move the search window toward an unconfirmed candidate.
      if (this.lost) {
        const consistent = this.recoveryCenter && Math.hypot((center.x - this.recoveryCenter.x) * this.width, (center.y - this.recoveryCenter.y) * this.height) <= radius * .5;
        this.recoveryHits = consistent ? this.recoveryHits + 1 : 1;
        this.recoveryCenter = center;
        if (this.recoveryHits < 2) {
          this.misses++;
          return { status: "lost", pixels: options ? Uint8ClampedArray.from(image.data) : new Uint8ClampedArray(0), center: this.center };
        }
      }
      this.center = center; this.lost = false; this.misses = 0; this.recoveryHits = 0; this.recoveryCenter = null;
      const pixels = options ? engine.render(options) : new Uint8ClampedArray(0);
      this.initial = engine; engine = null;
      return { status: "tracking", pixels, center };
    } catch { this.lost = true; return original(); }
    finally { engine?.dispose(); }
  }
  dispose() { this.initial?.dispose(); this.initial = null; this.disposed = true; }
}
