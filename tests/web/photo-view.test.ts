import { describe, expect, it } from 'vitest';
import { PhotoView } from '../../web/src/photo-view';
import { imagePoint } from '../../web/src/local-cover';

describe('magnified photo editing', () => {
  it('keeps translated, magnified sampling on the same source pixel', () => {
    const v = new PhotoView(); v.scale(1, 400, 400); v.move(50, -30, 400, 400);
    // A 400x400 canvas at left/top 0, magnified 2x around its centre.
    const left = -200 + v.x, top = -200 + v.y;
    expect(imagePoint(250 - left, 170 - top, 800, 800, 200, 400)).toEqual({ x: .5, y: .5 });
    expect(imagePoint(10, 400, 800, 800, 200, 400)).toBeNull();
  });
  it('bounds panning after zooming out and resizing, then resets all state', () => {
    const v = new PhotoView(); v.scale(3, 400, 400); v.pan = true;
    v.move(1000, -1000, 400, 400); expect([v.x, v.y]).toEqual([600, -600]);
    v.scale(-2, 400, 400); expect([v.x, v.y]).toEqual([200, -200]);
    v.resize(200, 300); expect([v.x, v.y]).toEqual([100, -150]);
    v.scale(-10, 200, 300); expect([v.zoom, v.x, v.y, v.pan]).toEqual([1, 0, 0, false]);
    v.scale(100, 200, 300); expect(v.zoom).toBe(4);
    v.reset(); expect(v.transform).toBe('translate(0px, 0px) scale(1)');
  });
});
