import type { NormalizedCircle, Point, RgbColor } from "../core/types";

export interface PreviewCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): {
    createImageData(width: number, height: number): { data: Uint8ClampedArray };
    putImageData(image: { data: Uint8ClampedArray }, x: number, y: number): void;
    clearRect(x: number, y: number, width: number, height: number): void;
  };
}
export function drawPixels(canvas: PreviewCanvas, pixels: Uint8ClampedArray, width: number, height: number) {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d");
  const image = context.createImageData(width, height);
  image.data.set(pixels);
  context.putImageData(image, 0, 0);
}
export function clearCanvas(canvas: PreviewCanvas | null) {
  if (canvas) canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
}
/** Paint calibration rings on a copy, preserving the pixels used for sampling. */
export function withSampleMarkers(pixels: Uint8ClampedArray, width: number, height: number, markers: readonly NormalizedCircle[]) {
  if (!markers.length) return pixels;
  const result = pixels.slice(), short = Math.min(width, height);
  markers.forEach((circle, index) => {
    const cx = circle.x * width, cy = circle.y * height, radius = circle.radius * short;
    const outer = radius + .01 * short;
    for (let y = Math.max(0, Math.floor(cy - outer)); y < Math.min(height, Math.ceil(cy + outer)); y++) {
      for (let x = Math.max(0, Math.floor(cx - outer)); x < Math.min(width, Math.ceil(cx + outer)); x++) {
        const edge = Math.abs(Math.hypot(x + .5 - cx, y + .5 - cy) - radius) / short;
        if (edge > .01) continue;
        result.set(edge <= .006 ? (index === 0 ? [150, 43, 67] : [112, 85, 45]) : [255, 255, 255], (y * width + x) * 4);
      }
    }
  });
  return result;
}
export function canvasPoint(event: WechatMiniprogram.TouchCanvas, width: number, height: number): Point | null {
  const touch = event.touches[0] ?? event.changedTouches[0];
  if (!touch || !Number.isFinite(touch.x) || !Number.isFinite(touch.y) || width <= 0 || height <= 0) return null;
  return { x: Math.max(0, Math.min(1, touch.x / width)), y: Math.max(0, Math.min(1, touch.y / height)) };
}
export function rgbHex(rgb: RgbColor): string {
  return `#${[rgb.r, rgb.g, rgb.b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}
export function parseHex(value: string): RgbColor {
  if (!/^#[\da-f]{6}$/i.test(value)) throw new Error("Invalid sample color");
  return { r: parseInt(value.slice(1, 3), 16), g: parseInt(value.slice(3, 5), 16), b: parseInt(value.slice(5, 7), 16) };
}
