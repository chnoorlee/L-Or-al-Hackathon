import { describe, expect, it } from 'vitest';
import { imagePoint } from '../../web/src/local-cover';

describe('photo selection coordinates', () => {
  it('rejects horizontal letterboxes and maps a portrait without shifting the selection', () => {
    expect(imagePoint(20, 200, 400, 400, 200, 400)).toBeNull();
    expect(imagePoint(100, 0, 400, 400, 200, 400)).toEqual({ x: 0, y: 0 });
    expect(imagePoint(200, 200, 400, 400, 200, 400)).toEqual({ x: 0.5, y: 0.5 });
  });
  it('rejects vertical letterboxes, invalid and outside coordinates', () => {
    expect(imagePoint(200, 20, 400, 400, 400, 200)).toBeNull();
    expect(imagePoint(200, 200, 400, 400, 400, 200)).toEqual({ x: 0.5, y: 0.5 });
    expect(imagePoint(NaN, 20, 400, 400, 400, 200)).toBeNull();
    expect(imagePoint(500, 200, 400, 400, 400, 200)).toBeNull();
  });
});
