import type { PixelBuffer, Point } from "../core/types";
import type { FaceAnchor } from "./face-detector";

/** Pixel-space similarity: x'=a*x-b*y+tx, y'=b*x+a*y+ty. */
export interface FaceTransform { a: number; b: number; tx: number; ty: number; width: number; height: number }
interface GrayFrame { width: number; height: number; data: Uint8Array; at: number }
interface Match { from: Point; to: Point }
export const FACE_REDETECT_AGE = 900;
export const FACE_FRAME_GAP = 250;
const EDGE = 160, PATCH = 3, SEARCH = 6;
const FEATURES = [33, 35, 37, 38, 40, 42, 52, 55, 58, 61, 43, 46, 47, 51, 84, 90];
const identity = (f: GrayFrame): FaceTransform => ({ a: 1, b: 0, tx: 0, ty: 0, width: f.width, height: f.height });
const move = (t: FaceTransform, p: Point): Point => ({ x: t.a * p.x - t.b * p.y + t.tx, y: t.b * p.x + t.a * p.y + t.ty });
function gray(image: PixelBuffer, at: number): GrayFrame {
  const scale = Math.min(1, EDGE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale));
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (Math.min(image.height - 1, Math.floor((y + .5) * image.height / height)) * image.width
      + Math.min(image.width - 1, Math.floor((x + .5) * image.width / width))) * 4;
    data[y * width + x] = Math.round(image.data[i] * .299 + image.data[i + 1] * .587 + image.data[i + 2] * .114);
  }
  return { width, height, data, at };
}
function inside(f: GrayFrame, x: number, y: number) {
  return x >= PATCH + 1 && y >= PATCH + 1 && x < f.width - PATCH - 1 && y < f.height - PATCH - 1;
}
function texture(f: GrayFrame, x: number, y: number): number {
  if (!inside(f, x, y)) return 0;
  let xx = 0, yy = 0, xy = 0;
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
    const k = (y + j) * f.width + x + i;
    const gx = f.data[k + 1] - f.data[k - 1], gy = f.data[k + f.width] - f.data[k - f.width];
    xx += gx * gx; yy += gy * gy; xy += gx * gy;
  }
  return (xx + yy - Math.sqrt((xx - yy) ** 2 + 4 * xy * xy)) / 50;
}
function selectFeatures(f: GrayFrame, anchor: FaceAnchor): Point[] {
  const points: Point[] = [];
  for (const index of FEATURES) {
    const p = anchor.points[index];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const cx = Math.round(p.x * f.width), cy = Math.round(p.y * f.height);
    let best: Point | null = null, score = 18;
    for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) {
      const value = texture(f, x, y);
      if (value > score && points.every(q => Math.hypot(q.x - x, q.y - y) >= 5)) { best = { x, y }; score = value; }
    }
    if (best) points.push(best);
  }
  return points;
}
/** Zero-mean patch differences tolerate modest exposure changes. */
function matchPatch(from: GrayFrame, to: GrayFrame, p: Point): Point | null {
  const px = Math.round(p.x), py = Math.round(p.y);
  if (!inside(from, px, py)) return null;
  const n = (PATCH * 2 + 1) ** 2;
  let sum = 0;
  for (let y = -PATCH; y <= PATCH; y++) for (let x = -PATCH; x <= PATCH; x++) sum += from.data[(py + y) * from.width + px + x];
  const mean = sum / n;
  let best: Point | null = null, bestError = 22;
  const evaluate = (x: number, y: number) => {
    if (!inside(to, x, y)) return;
    let targetSum = 0;
    for (let j = -PATCH; j <= PATCH; j++) for (let i = -PATCH; i <= PATCH; i++) targetSum += to.data[(y + j) * to.width + x + i];
    const offset = targetSum / n - mean;
    let error = 0;
    for (let j = -PATCH; j <= PATCH; j++) for (let i = -PATCH; i <= PATCH; i++)
      error += Math.abs(to.data[(y + j) * to.width + x + i] - from.data[(py + j) * from.width + px + i] - offset);
    error = error / n + .025 * Math.hypot(x - px, y - py);
    if (error < bestError) { bestError = error; best = { x, y }; }
  };
  for (let y = py - SEARCH; y <= py + SEARCH; y += 2) for (let x = px - SEARCH; x <= px + SEARCH; x += 2) evaluate(x, y);
  const coarse = best as Point | null;
  if (coarse) for (let y = coarse.y - 1; y <= coarse.y + 1; y++) for (let x = coarse.x - 1; x <= coarse.x + 1; x++) evaluate(x, y);
  return best;
}
function fit(matches: Match[], frame: GrayFrame): FaceTransform | null {
  const n = matches.length;
  if (n < 2) return null;
  const source = { x: 0, y: 0 }, target = { x: 0, y: 0 };
  for (const m of matches) { source.x += m.from.x / n; source.y += m.from.y / n; target.x += m.to.x / n; target.y += m.to.y / n; }
  let denominator = 0, real = 0, imaginary = 0;
  for (const m of matches) {
    const x = m.from.x - source.x, y = m.from.y - source.y, u = m.to.x - target.x, v = m.to.y - target.y;
    denominator += x * x + y * y; real += x * u + y * v; imaginary += x * v - y * u;
  }
  if (denominator < 100) return null;
  const a = real / denominator, b = imaginary / denominator;
  return { a, b, tx: target.x - a * source.x + b * source.y, ty: target.y - b * source.x - a * source.y, width: frame.width, height: frame.height };
}
function step(from: GrayFrame, to: GrayFrame, points: Point[]): { transform: FaceTransform; points: Point[] } | null {
  if (to.at - from.at > FACE_FRAME_GAP || from.width !== to.width || from.height !== to.height) return null;
  const matches: Match[] = [];
  for (const p of points) {
    const q = matchPatch(from, to, p), back = q && matchPatch(to, from, q);
    if (q && back && Math.hypot(back.x - p.x, back.y - p.y) <= 1.5) matches.push({ from: p, to: q });
  }
  if (matches.length < 6 || matches.length < points.length * .6) return null;
  let consensus: Match[] = [];
  // Deterministic pair consensus prevents a moving mouth/occluder from dragging the skin layer.
  for (let i = 0; i < matches.length; i++) for (let j = i + 1; j < matches.length; j++) {
    const candidate = fit([matches[i], matches[j]], to);
    if (!candidate) continue;
    const inliers = matches.filter(m => { const p = move(candidate, m.from); return Math.hypot(p.x - m.to.x, p.y - m.to.y) <= 1.6; });
    if (inliers.length > consensus.length) consensus = inliers;
  }
  if (consensus.length < 6 || consensus.length < points.length * .6) return null;
  const transform = fit(consensus, to);
  if (!transform || Math.hypot(transform.a, transform.b) < .92 || Math.hypot(transform.a, transform.b) > 1.08 || Math.abs(Math.atan2(transform.b, transform.a)) > .12) return null;
  return { transform, points: consensus.map(m => m.to) };
}
function compose(next: FaceTransform, previous: FaceTransform): FaceTransform {
  return { ...next, a: next.a * previous.a - next.b * previous.b, b: next.b * previous.a + next.a * previous.b,
    tx: next.a * previous.tx - next.b * previous.ty + next.tx, ty: next.b * previous.tx + next.a * previous.ty + next.ty };
}

/** Short-lived grayscale history aligns delayed landmarks with the CURRENT camera frame. */
export class FaceMotionTracker {
  private history: GrayFrame[] = [];
  private points: Point[] = [];
  private transform: FaceTransform | null = null;
  private detectedAt = 0;
  push(image: PixelBuffer, at: number): FaceTransform | null {
    const frame = gray(image, at), previous = this.history[this.history.length - 1];
    if (previous && (previous.width !== frame.width || previous.height !== frame.height || at <= previous.at)) this.dispose();
    if (this.transform && previous) {
      const result = at - this.detectedAt <= FACE_REDETECT_AGE ? step(previous, frame, this.points) : null;
      if (result) { this.points = result.points; this.transform = compose(result.transform, this.transform); }
      else this.reset();
    }
    this.history.push(frame);
    while (this.history.length > 32 || (this.history[0] && at - this.history[0].at > FACE_REDETECT_AGE)) this.history.shift()!.data.fill(0);
    return this.transform;
  }
  seed(anchor: FaceAnchor, capturedAt: number, now: number): FaceTransform | null {
    this.reset();
    const index = this.history.findIndex(frame => frame.at === capturedAt), latest = this.history[this.history.length - 1];
    if (index < 0 || !latest || now - capturedAt > FACE_REDETECT_AGE || now - latest.at > FACE_FRAME_GAP) return null;
    const first = this.history[index];
    let points = selectFeatures(first, anchor), transform = identity(first);
    // A fresh native result may display immediately. Texture evidence is mandatory
    // before carrying that mask to any subsequent frame.
    for (let i = index + 1; i < this.history.length; i++) {
      const result = step(this.history[i - 1], this.history[i], points);
      if (!result) return null;
      points = result.points; transform = compose(result.transform, transform);
    }
    this.points = points; this.transform = transform; this.detectedAt = capturedAt;
    return transform;
  }
  reset() { this.points = []; this.transform = null; this.detectedAt = 0; }
  dispose() { this.reset(); for (const frame of this.history) frame.data.fill(0); this.history = []; }
}
