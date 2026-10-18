import type { Point } from "../core/types";

/** Fill pixel centers using even-odd boundaries; zero clears a cutout in an existing mask. */
export function paintPolygon(mask: Uint8Array, width: number, height: number, points: readonly Point[], value: number): void {
  const crossings: number[] = [];
  // Find the first center at or right of an edge. Check in normalized coordinates
  // so a center exactly on a boundary keeps the same rule despite multiplication rounding.
  const firstCenter = (edge: number): number => {
    let x = Math.max(0, Math.min(width, Math.ceil(edge * width - .5)));
    while (x < width && (x + .5) / width < edge) x++;
    while (x > 0 && (x - .5) / width >= edge) x--;
    return x;
  };
  for (let y = 0; y < height; y++) {
    const ny = (y + .5) / height;
    crossings.length = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i], b = points[j];
      if ((a.y > ny) !== (b.y > ny)) crossings.push((b.x - a.x) * (ny - a.y) / (b.y - a.y) + a.x);
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      mask.fill(value, y * width + firstCenter(crossings[i]), y * width + firstCenter(crossings[i + 1]));
    }
  }
}
