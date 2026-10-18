import { srgbChannelToLinear } from "../core/color";
import type { PixelBuffer, Point, RgbColor } from "../core/types";
import type { FaceAnchor } from "./face-detector";
import { paintPolygon } from "./polygon-mask";

export interface FaceLayer {
  width: number; height: number; masks: Uint8Array;
  skin: RgbColor; skinLuminance: number; lipLuminance: number;
}
export interface FaceLook {
  foundation: boolean; lipstick: boolean; blush: boolean;
  lipColor: RgbColor; blushColor: RgbColor; lipStrength: number; blushStrength: number;
  lipFinish: "satin" | "velvet";
}
export const DEFAULT_FACE_LOOK: Readonly<FaceLook> = Object.freeze({
  foundation: true, lipstick: false, blush: false,
  lipColor: { r: 155, g: 57, b: 80 }, blushColor: { r: 202, g: 107, b: 118 },
  lipStrength: 65, blushStrength: 35, lipFinish: "satin",
});
// Tencent's documented 106-point layout, not MediaPipe/68-point indices:
// https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/visionkit/face.html
const sequence = (start: number, count: number) => Array.from({ length: count }, (_, i) => start + i);
export const FACE_TOPOLOGY = {
  contour: sequence(0, 33),
  leftEye: [52, 53, 72, 54, 55, 56, 73, 57], rightEye: [58, 59, 75, 60, 61, 62, 76, 63],
  leftBrow: [33, 34, 35, 36, 37, 67, 66, 65, 64], rightBrow: [38, 39, 40, 41, 42, 71, 70, 69, 68],
  outerLip: sequence(84, 12), innerLip: sequence(96, 8),
  nose: [43, 80, 47, 48, 49, 50, 51, 81],
};
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const mean = (points: readonly Point[]): Point => ({ x: points.reduce((n, p) => n + p.x, 0) / points.length, y: points.reduce((n, p) => n + p.y, 0) / points.length });
const mix = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const luminance = (c: RgbColor) => .2126 * srgbChannelToLinear(c.r) + .7152 * srgbChannelToLinear(c.g) + .0722 * srgbChannelToLinear(c.b);
function expand(points: Point[], amount: number): Point[] { const center = mean(points); return points.map(p => mix(center, p, amount)); }
function medianColor(image: PixelBuffer, centers: Point[], radius: number): RgbColor | null {
  const channels: number[][] = [[], [], []];
  for (const center of centers) {
    const cx = center.x * image.width, cy = center.y * image.height;
    for (let y = Math.max(0, Math.floor(cy - radius)); y < Math.min(image.height, cy + radius); y++)
      for (let x = Math.max(0, Math.floor(cx - radius)); x < Math.min(image.width, cx + radius); x++) {
        if (Math.hypot(x + .5 - cx, y + .5 - cy) > radius) continue;
        const i = (y * image.width + x) * 4;
        if (image.data[i + 3] < 250) continue;
        for (let c = 0; c < 3; c++) channels[c].push(image.data[i + c]);
      }
  }
  if (channels[0].length < 9) return null;
  const values = channels.map(c => c.sort((a, b) => a - b)[Math.floor(c.length / 2)]);
  return { r: values[0], g: values[1], b: values[2] };
}
/** Two-pass distance transform feathers the silhouette and the eye/mouth cutouts inward. */
function feather(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const distance = Float32Array.from(mask, v => v ? 1000 : 0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (!x || !y || x === width - 1 || y === height - 1) { distance[i] = 0; continue; }
    distance[i] = Math.min(distance[i], distance[i - 1] + 1, distance[i - width] + 1, distance[i - width - 1] + 1.414, distance[i - width + 1] + 1.414);
  }
  for (let y = height - 2; y > 0; y--) for (let x = width - 2; x > 0; x--) {
    const i = y * width + x;
    distance[i] = Math.min(distance[i], distance[i + 1] + 1, distance[i + width] + 1, distance[i + width + 1] + 1.414, distance[i + width - 1] + 1.414);
  }
  return Uint8Array.from(distance, d => Math.round(clamp(d / radius, 0, 1) * 255));
}

/** Masks follow each observed face. No identity recognition, diagnosis, or retained face template. */
export function buildFaceLayer(image: PixelBuffer, anchors: readonly FaceAnchor[]): FaceLayer | null {
  if (anchors.length !== 1 || image.width > 320 || image.height > 320 || image.width < 1 || image.height < 1 || image.data.length !== image.width * image.height * 4) return null;
  const anchor = anchors[0], p = anchor.points;
  // Pupil points 104/105 are optional in detectFace and are not used by these masks.
  const important = [...new Set([...Object.values(FACE_TOPOLOGY).flat(), 44, 45, 46])];
  if (!p || p.length !== 106 || important.some(i => !p[i] || !Number.isFinite(p[i].x) || !Number.isFinite(p[i].y) || p[i].x <= 0 || p[i].x >= 1 || p[i].y <= 0 || p[i].y >= 1)) return null;
  if (anchor.confidence?.length && important.some(i => !Number.isFinite(anchor.confidence[i]) || anchor.confidence[i] < .5)) return null;
  const width = image.width, height = image.height, at = (ids: number[]) => ids.map(i => p[i]);
  const leftEye = mean(at(FACE_TOPOLOGY.leftEye)), rightEye = mean(at(FACE_TOPOLOGY.rightEye));
  const eyeDistance = Math.hypot((rightEye.x - leftEye.x) * width, (rightEye.y - leftEye.y) * height);
  const jawWidth = Math.hypot((p[32].x - p[0].x) * width, (p[32].y - p[0].y) * height);
  if (eyeDistance < 15 || jawWidth < 30 || eyeDistance / jawWidth < .2 || eyeDistance / jawWidth > .8) return null;
  const noseLeft = Math.hypot(p[46].x - leftEye.x, p[46].y - leftEye.y), noseRight = Math.hypot(p[46].x - rightEye.x, p[46].y - rightEye.y);
  if (Math.min(noseLeft, noseRight) / Math.max(noseLeft, noseRight) < .42) return null; // extreme profiles
  const up = { x: (p[43].x - p[46].x) * .75, y: (p[43].y - p[46].y) * .75 };
  const forehead = [42, 41, 40, 39, 38, 37, 36, 35, 34, 33].map(i => ({ x: clamp(p[i].x + up.x, .01, .99), y: clamp(p[i].y + up.y, .01, .99) }));
  const silhouette = [...at(FACE_TOPOLOGY.contour), ...forehead];
  const holes = [expand(at(FACE_TOPOLOGY.leftEye), 1.32), expand(at(FACE_TOPOLOGY.rightEye), 1.32), expand(at(FACE_TOPOLOGY.leftBrow), 1.16), expand(at(FACE_TOPOLOGY.rightBrow), 1.16), expand(at(FACE_TOPOLOGY.outerLip), 1.16), expand(at(FACE_TOPOLOGY.nose), 1.15)];
  const lips = at(FACE_TOPOLOGY.outerLip), mouth = at(FACE_TOPOLOGY.innerLip);
  const cheekA = mix(p[7], p[80], .56), cheekB = mix(p[25], p[81], .56);
  const skin = medianColor(image, [cheekA, cheekB, mix(p[45], p[46], .3)], Math.max(2, eyeDistance * .07));
  const lip = medianColor(image, [mix(p[93], p[102], .55)], Math.max(2.5, eyeDistance * .025));
  if (!skin || !lip || luminance(skin) < .008) return null;
  const skinMask = new Uint8Array(width * height), lipMask = new Uint8Array(width * height), masks = new Uint8Array(width * height * 4);
  paintPolygon(skinMask, width, height, silhouette, 1);
  for (const hole of holes) paintPolygon(skinMask, width, height, hole, 0);
  paintPolygon(lipMask, width, height, lips, 1);
  paintPolygon(lipMask, width, height, mouth, 0);
  const axis = { x: (rightEye.x - leftEye.x) * width / eyeDistance, y: (rightEye.y - leftEye.y) * height / eyeDistance };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const nx = (x + .5) / width, ny = (y + .5) / height, i = y * width + x;
    if (image.data[i * 4 + 3] < 250) { skinMask[i] = 0; lipMask[i] = 0; continue; }
    if (skinMask[i]) {
      let weight = 0;
      for (const cheek of [cheekA, cheekB]) {
        const dx = (nx - cheek.x) * width, dy = (ny - cheek.y) * height;
        const u = (dx * axis.x + dy * axis.y) / (eyeDistance * .33), v = (-dx * axis.y + dy * axis.x) / (eyeDistance * .24);
        weight = Math.max(weight, Math.max(0, Math.exp(-2.2 * (u * u + v * v)) - .04) / .96);
      }
      masks[i * 4 + 2] = Math.round(weight * 255);
    }
  }
  const base = feather(skinMask, width, height, Math.max(2, eyeDistance * .06));
  const lipEdge = feather(lipMask, width, height, Math.max(1.5, eyeDistance * .025));
  for (let i = 0; i < skinMask.length; i++) { masks[i * 4] = base[i]; masks[i * 4 + 1] = lipEdge[i]; masks[i * 4 + 2] = Math.round(masks[i * 4 + 2] * base[i] / 255); }
  return { width, height, masks, skin, skinLuminance: luminance(skin), lipLuminance: Math.max(.005, luminance(lip)) };
}
