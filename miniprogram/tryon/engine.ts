import { srgbChannelToLinear, srgbToLab } from "../core/color";
import type { LabColor, NormalizedCircle, PixelBuffer, Point, RgbColor } from "../core/types";

/** Engineering parameters, not a trained disease detector or measured cosmetic model. */
export const TRYON_VERSION = "seed-lab-linear-blend-v1";
export const PREVIEW_MAX_EDGE = 640;
const MAX_UNDO = 6;
const LINEAR = Float32Array.from({ length: 256 }, (_, i) => srgbChannelToLinear(i));

export type Formula = "sheer" | "concealer" | "soft";
export type PreviewMode = "effect" | "split" | "original";
export interface RenderOptions {
  formula: Formula;
  strength: number;
  warmth: number;
  brightness: number;
  feather: number;
  mode: PreviewMode;
  split: number;
  outline: boolean;
}
export const DEFAULT_RENDER: Readonly<RenderOptions> = Object.freeze({
  formula: "concealer", strength: 78, warmth: 0, brightness: 0,
  feather: 4, mode: "split", split: 50, outline: true,
});

export interface RegionResult {
  selectedPixels: number;
  reason: "selected" | "no_region" | "similar_samples";
  touchesEdge: boolean;
}

/** Small analysis texture for the live compositor; pixels never enter Page.data. */
export interface MakeupLayer {
  width: number;
  height: number;
  distances: Uint8Array;
  reference: RgbColor;
  coverLuminance: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
function finite(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) throw new RangeError("Non-finite preview parameter");
  return clamp(value, low, high);
}
function distance(a: LabColor, b: LabColor): number {
  return Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b);
}
function encode(linear: number): number {
  const v = clamp(linear, 0, 1);
  return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
}
function assertCircle(circle: NormalizedCircle) {
  if (![circle.x, circle.y, circle.radius].every(Number.isFinite) ||
      circle.x < 0 || circle.x > 1 || circle.y < 0 || circle.y > 1 || circle.radius <= 0) {
    throw new RangeError("Invalid preview sample");
  }
}

/** A bounded, private copy. Never mutate the session's canonical analysis pixels. */
export function resizeForPreview(image: PixelBuffer, maxEdge = PREVIEW_MAX_EDGE): { width: number; height: number; data: Uint8ClampedArray } {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) ||
      image.width < 1 || image.height < 1 || image.data.length !== image.width * image.height * 4) {
    throw new RangeError("Invalid preview image");
  }
  const scale = Math.min(1, finite(maxEdge, 1, PREVIEW_MAX_EDGE) / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, Math.floor((x + 0.5) * image.width / width));
      const sy = Math.min(image.height - 1, Math.floor((y + 0.5) * image.height / height));
      for (let c = 0; c < 4; c++) data[(y * width + x) * 4 + c] = image.data[(sy * image.width + sx) * 4 + c];
    }
  }
  return { width, height, data };
}

/** Interactive color segmentation. It identifies a seed-connected color region, not vitiligo. */
export class TryOnEngine {
  readonly width: number;
  readonly height: number;
  readonly source: Uint8ClampedArray;
  readonly mask: Uint8Array;
  private readonly labs: Float32Array;
  private readonly reference: RgbColor;
  private readonly coverLuminance: number;
  private history: Uint8Array[] = [];
  private edgeDistance: Float32Array | null = null;
  private disposed = false;

  constructor(image: PixelBuffer, readonly cover: NormalizedCircle, readonly surrounding: NormalizedCircle,
    private readonly coverLab: LabColor, private readonly surroundingLab: LabColor, reference: RgbColor) {
    assertCircle(cover);
    assertCircle(surrounding);
    if (![coverLab.l, coverLab.a, coverLab.b, surroundingLab.l, surroundingLab.a, surroundingLab.b].every(Number.isFinite)) {
      throw new RangeError("Invalid sample colors");
    }
    const preview = resizeForPreview(image);
    this.width = preview.width;
    this.height = preview.height;
    this.source = preview.data;
    this.mask = new Uint8Array(this.width * this.height);
    this.labs = new Float32Array(this.mask.length * 3);
    this.reference = { r: finite(reference.r, 0, 255), g: finite(reference.g, 0, 255), b: finite(reference.b, 0, 255) };
    let sum = 0;
    let count = 0;
    const radius = cover.radius * Math.min(this.width, this.height);
    for (let i = 0; i < this.mask.length; i++) {
      const p = i * 4;
      const rgb = { r: this.source[p], g: this.source[p + 1], b: this.source[p + 2] };
      const lab = srgbToLab(rgb);
      this.labs.set([lab.l, lab.a, lab.b], i * 3);
      if (this.source[p + 3] === 255 && Math.hypot(i % this.width + 0.5 - cover.x * this.width,
        Math.floor(i / this.width) + 0.5 - cover.y * this.height) <= radius) {
        sum += 0.2126 * LINEAR[rgb.r] + 0.7152 * LINEAR[rgb.g] + 0.0722 * LINEAR[rgb.b];
        count++;
      }
    }
    if (!count) throw new RangeError("No opaque cover sample pixels");
    this.coverLuminance = Math.max(0.005, sum / count);
  }

  get canUndo(): boolean { return this.history.length > 0; }
  get selectedPixels(): number { return this.mask.reduce((n, v) => n + (v > 0 ? 1 : 0), 0); }

  checkpoint(): void {
    this.assertAlive();
    this.history.push(this.mask.slice());
    if (this.history.length > MAX_UNDO) this.history.shift();
  }
  undo(): boolean {
    this.assertAlive();
    const previous = this.history.pop();
    if (!previous) return false;
    this.mask.set(previous);
    this.edgeDistance = null;
    return true;
  }
  clear(): void {
    this.checkpoint();
    this.mask.fill(0);
    this.edgeDistance = null;
  }

  segment(tolerance = 18, seed: Point = this.cover, append = false, remember = true): RegionResult {
    this.assertAlive();
    tolerance = finite(tolerance, 5, 40);
    if (remember) this.checkpoint();
    if (!append) this.mask.fill(0);
    this.edgeDistance = null;
    if (distance(this.coverLab, this.surroundingLab) < 4) return this.regionResult("similar_samples");
    const sx = Math.min(this.width - 1, Math.floor(finite(seed.x, 0, 1) * this.width));
    const sy = Math.min(this.height - 1, Math.floor(finite(seed.y, 0, 1) * this.height));
    const eligible = (i: number) => {
      if (this.source[i * 4 + 3] !== 255) return false;
      const x = i % this.width + 0.5, y = Math.floor(i / this.width) + 0.5;
      if (Math.hypot(x - this.surrounding.x * this.width, y - this.surrounding.y * this.height) <=
          this.surrounding.radius * Math.min(this.width, this.height)) return false;
      const color = { l: this.labs[i * 3], a: this.labs[i * 3 + 1], b: this.labs[i * 3 + 2] };
      const coverDistance = distance(color, this.coverLab);
      return coverDistance <= tolerance && coverDistance + 1 < distance(color, this.surroundingLab);
    };
    let start = sy * this.width + sx;
    // Search only within the confirmed A sample if its center is a hair/highlight.
    if (!eligible(start) && !append) {
      let nearest = Infinity;
      start = -1;
      const radius = this.cover.radius * Math.min(this.width, this.height);
      for (let y = Math.max(0, Math.floor(sy - radius)); y <= Math.min(this.height - 1, sy + radius); y++) {
        for (let x = Math.max(0, Math.floor(sx - radius)); x <= Math.min(this.width - 1, sx + radius); x++) {
          const d = Math.hypot(x - sx, y - sy);
          if (d <= radius && d < nearest && eligible(y * this.width + x)) { start = y * this.width + x; nearest = d; }
        }
      }
    }
    if (start < 0 || !eligible(start)) return this.regionResult("no_region");
    const queue = new Int32Array(this.mask.length);
    const visited = new Uint8Array(this.mask.length);
    let head = 0, tail = 1;
    queue[0] = start;
    visited[start] = 1;
    while (head < tail) {
      const i = queue[head++];
      this.mask[i] = 255;
      const x = i % this.width;
      for (const next of [x > 0 ? i - 1 : -1, x < this.width - 1 ? i + 1 : -1, i - this.width, i + this.width]) {
        if (next >= 0 && next < this.mask.length && !visited[next]) {
          visited[next] = 1;
          if (eligible(next)) queue[tail++] = next;
        }
      }
    }
    return this.regionResult("selected");
  }

  /** One continuous stroke; the caller takes one checkpoint per gesture. */
  brush(from: Point, to: Point, radius: number, erase: boolean): void {
    this.assertAlive();
    radius = finite(radius, 0.005, 0.2) * Math.min(this.width, this.height);
    const a = { x: finite(from.x, 0, 1) * this.width, y: finite(from.y, 0, 1) * this.height };
    const b = { x: finite(to.x, 0, 1) * this.width, y: finite(to.y, 0, 1) * this.height };
    const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
    for (let y = Math.max(0, Math.floor(Math.min(a.y, b.y) - radius)); y < Math.min(this.height, Math.ceil(Math.max(a.y, b.y) + radius)); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(a.x, b.x) - radius)); x < Math.min(this.width, Math.ceil(Math.max(a.x, b.x) + radius)); x++) {
        const t = length2 === 0 ? 0 : clamp(((x + 0.5 - a.x) * dx + (y + 0.5 - a.y) * dy) / length2, 0, 1);
        const i = y * this.width + x;
        if (Math.hypot(x + 0.5 - a.x - t * dx, y + 0.5 - a.y - t * dy) <= radius && this.source[i * 4 + 3] === 255) {
          this.mask[i] = erase ? 0 : 255;
        }
      }
    }
    this.edgeDistance = null;
  }

  shade(warmth: number, brightness: number): RgbColor {
    const w = finite(warmth, -30, 30), b = finite(brightness, -30, 30);
    return { r: clamp(this.reference.r + b + w * 0.35, 0, 255),
      g: clamp(this.reference.g + b, 0, 255), b: clamp(this.reference.b + b - w * 0.45, 0, 255) };
  }

  layer(): MakeupLayer {
    this.assertAlive();
    return { width: this.width, height: this.height, distances: Uint8Array.from(this.distances(), d => Math.min(255, d)),
      reference: { ...this.reference }, coverLuminance: this.coverLuminance };
  }

  render(options: RenderOptions, targetColor?: RgbColor): Uint8ClampedArray {
    this.assertAlive();
    const output = this.source.slice();
    const strength = finite(options.strength, 0, 100) / 100;
    const split = finite(options.split, 0, 100) / 100;
    const feather = finite(options.feather, 0, 16);
    const shade = targetColor ? {
      r: finite(targetColor.r, 0, 255), g: finite(targetColor.g, 0, 255), b: finite(targetColor.b, 0, 255),
    } : this.shade(options.warmth, options.brightness);
    if (!(["sheer", "concealer", "soft"] as string[]).includes(options.formula) ||
        !(["effect", "split", "original"] as string[]).includes(options.mode)) throw new RangeError("Invalid rendering mode");
    if (options.mode === "original") return output;
    const color = [shade.r, shade.g, shade.b].map(srgbChannelToLinear);
    const edges = this.distances();
    // Texture/shading coefficients are creative effect settings, not product measurements.
    const texture = options.formula === "soft" ? 0.58 : options.formula === "sheer" ? 1 : 0.86;
    const opacity = strength * (options.formula === "sheer" ? 0.55 : 1);
    for (let i = 0; i < this.mask.length; i++) {
      if (!this.mask[i] || (options.mode === "split" && (i % this.width + 0.5) / this.width < split)) continue;
      const p = i * 4;
      const edgeAlpha = feather === 0 ? 1 : clamp(edges[i] / feather, 0, 1);
      const alpha = opacity * edgeAlpha;
      const luminance = 0.2126 * LINEAR[this.source[p]] + 0.7152 * LINEAR[this.source[p + 1]] + 0.0722 * LINEAR[this.source[p + 2]];
      const shading = clamp(1 + (luminance / this.coverLuminance - 1) * texture, 0.3, 1.8);
      for (let c = 0; c < 3; c++) output[p + c] = encode(LINEAR[this.source[p + c]] * (1 - alpha) + color[c] * shading * alpha);
      if (options.outline && edges[i] <= 1) {
        output[p] = 216; output[p + 1] = 187; output[p + 2] = 135;
      }
    }
    return output;
  }

  dispose(): void {
    this.source.fill(0); this.mask.fill(0); this.labs.fill(0);
    for (const item of this.history) item.fill(0);
    this.history = []; this.edgeDistance = null; this.disposed = true;
  }
  private assertAlive() { if (this.disposed) throw new Error("Preview was cleared"); }
  private regionResult(reason: RegionResult["reason"]): RegionResult {
    let touchesEdge = false;
    for (let i = 0; i < this.mask.length; i++) if (this.mask[i] &&
      (i < this.width || i >= this.mask.length - this.width || i % this.width === 0 || i % this.width === this.width - 1)) touchesEdge = true;
    return { reason, selectedPixels: this.selectedPixels, touchesEdge };
  }
  private distances(): Float32Array {
    if (this.edgeDistance) return this.edgeDistance;
    const d = new Float32Array(this.mask.length);
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      const i = y * this.width + x;
      d[i] = !this.mask[i] ? 0 : Math.min(x === 0 ? 1 : d[i - 1] + 1, y === 0 ? 1 : d[i - this.width] + 1);
    }
    for (let y = this.height - 1; y >= 0; y--) for (let x = this.width - 1; x >= 0; x--) {
      const i = y * this.width + x;
      if (this.mask[i]) d[i] = Math.min(d[i], x === this.width - 1 ? 1 : d[i + 1] + 1, y === this.height - 1 ? 1 : d[i + this.width] + 1);
    }
    this.edgeDistance = d;
    return d;
  }
}
