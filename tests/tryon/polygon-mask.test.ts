import { describe, expect, it } from "vitest";
import { paintPolygon } from "../../miniprogram/tryon/polygon-mask";
import type { Point } from "../../miniprogram/core/types";

const polygon = (coords: number[][]): Point[] => coords.map(([x, y]) => ({ x, y }));

describe("pixel-center polygon filling", () => {
  it("includes left/top centers and excludes right/bottom centers, regardless of winding", () => {
    const shape = polygon([[.125, .125], [.625, .125], [.625, .625], [.125, .625]]);
    for (const points of [shape, [...shape].reverse()]) {
      const mask = new Uint8Array(16);
      paintPolygon(mask, 4, 4, points, 1);
      expect([...mask]).toEqual([1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    }
  });
  it("handles a concave silhouette, clips to the frame and clears only the mouth cutout", () => {
    const mask = new Uint8Array(16);
    paintPolygon(mask, 4, 4, polygon([[-1, -1], [2, -1], [2, .5], [.5, .5], [.5, 2], [-1, 2]]), 1);
    expect([...mask]).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0]);
    paintPolygon(mask, 4, 4, polygon([[.25, .25], [.5, .25], [.5, .75], [.25, .75]]), 0);
    expect([...mask]).toEqual([1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0]);
  });
  it("matches an independent ray-casting reference for rotated, crossed and off-frame polygons on non-square frames", () => {
    // Slow per-pixel oracle intentionally uses a different algorithm from scanline filling.
    const inside = (x: number, y: number, points: readonly Point[]) => {
      let result = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i], b = points[j];
        if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) result = !result;
      }
      return Number(result);
    };
    const shapes = [
      polygon([[.1, .1], [.9, .9], [.9, .1], [.1, .9]]),
      polygon([[-.2, .3], [.4, -.2], [.4, .4], [1.2, .4], [.7, 1.1], [.1, .8]]),
      polygon([[.2, .5], [.5, .5], [.8, .5]]),
      polygon([[.3, .2], [.8, .4], [.7, .9], [.2, .7]]),
      [],
    ];
    for (const [width, height] of [[7, 13], [128, 256], [256, 144]]) for (const shape of shapes) {
      const mask = new Uint8Array(width * height), expected = new Uint8Array(mask.length);
      paintPolygon(mask, width, height, shape, 1);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) expected[y * width + x] = inside((x + .5) / width, (y + .5) / height, shape);
      expect(mask).toEqual(expected);
    }
  });
});
