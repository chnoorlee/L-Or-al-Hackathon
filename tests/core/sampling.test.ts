import { describe, expect, it } from "vitest";

import {
  median,
  medianAbsoluteDeviation,
  sampleCircularRoi,
  srgbToLab,
  summarizeLabColors,
  type PixelBuffer,
} from "../../miniprogram/core";

function solidImage(width: number, height: number, rgba: readonly number[]): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data.set(rgba, offset);
  }
  return { width, height, data };
}

const fullThreeByThreeCircle = { x: 0.5, y: 0.5, radius: 0.5 };

describe("robust statistics", () => {
  it("averages the two middle values for an even sample", () => {
    expect(median([9, 1, 5, 3])).toBe(4);
  });

  it("computes per-channel medians and median absolute deviations", () => {
    expect(
      summarizeLabColors([
        { l: 10, a: 1, b: 4 },
        { l: 20, a: 3, b: 8 },
        { l: 30, a: 100, b: 12 },
      ]),
    ).toEqual({
      lab: { l: 20, a: 3, b: 8 },
      dispersion: { lMad: 10, aMad: 2, bMad: 4 },
    });
    expect(medianAbsoluteDeviation([1, 2, 100])).toBe(1);
  });

  it("rejects empty and non-finite samples", () => {
    expect(() => median([])).toThrow(RangeError);
    expect(() => median([1, Number.NaN])).toThrow(TypeError);
  });
});

describe("circular ROI sampling", () => {
  it("uses pixel centers and returns the component-wise median Lab color", () => {
    const image = solidImage(3, 3, [128, 64, 32, 255]);
    const result = sampleCircularRoi(image, fullThreeByThreeCircle, {
      minValidPixels: 9,
      clippedPixelRatioWarn: 0.05,
    });
    expect(result.validPixelCount).toBe(9);
    expect(result.excludedPixelCount).toBe(0);
    expect(result.lab).toEqual(srgbToLab({ r: 128, g: 64, b: 32 }));
    expect(result.dispersion).toEqual({ lMad: 0, aMad: 0, bMad: 0 });
    expect(result.qualityReasons).toEqual([]);
    expect(result.isUsable).toBe(true);
  });

  it("excludes semi-transparent and invalid numeric pixels", () => {
    const image = solidImage(3, 3, [128, 64, 32, 255]);
    const data = Array.from(image.data);
    data[3] = 128;
    data[4] = Number.NaN;
    const result = sampleCircularRoi(
      { ...image, data },
      fullThreeByThreeCircle,
      { minValidPixels: 7, clippedPixelRatioWarn: 0.05 },
    );
    expect(result.validPixelCount).toBe(7);
    expect(result.excludedPixelCount).toBe(2);
    expect(result.isUsable).toBe(true);
  });

  it("treats exposure clipping as a warning and insufficient pixels as a blocker", () => {
    const result = sampleCircularRoi(
      solidImage(3, 3, [255, 255, 255, 255]),
      fullThreeByThreeCircle,
      { minValidPixels: 10, clippedPixelRatioWarn: 0.05 },
    );
    expect(result.validPixelCount).toBe(9);
    expect(result.clippedPixelRatio).toBe(1);
    expect(result.qualityReasons).toEqual([
      "INSUFFICIENT_VALID_PIXELS",
      "EXPOSURE_CLIPPING",
    ]);
    expect(result.isUsable).toBe(false);
    expect(result.lab).not.toBeNull();
  });

  it("rejects malformed buffers and circles outside the fixed analysis image", () => {
    expect(() =>
      sampleCircularRoi(
        { width: 2, height: 2, data: new Uint8ClampedArray(3) },
        { x: 0.5, y: 0.5, radius: 0.2 },
        { minValidPixels: 1, clippedPixelRatioWarn: 0.05 },
      ),
    ).toThrow(RangeError);
    expect(() =>
      sampleCircularRoi(
        solidImage(2, 2, [1, 2, 3, 255]),
        { x: 0, y: 0, radius: 0.2 },
        { minValidPixels: 1, clippedPixelRatioWarn: 0.05 },
      ),
    ).toThrow(RangeError);
  });

  it("keeps exact median semantics for a larger ROI without per-pixel objects", () => {
    const image = solidImage(128, 128, [90, 120, 150, 255]);
    const result = sampleCircularRoi(
      image,
      { x: 0.5, y: 0.5, radius: 0.49 },
      { minValidPixels: 100, clippedPixelRatioWarn: 0.05 },
    );
    expect(result.isUsable).toBe(true);
    expect(result.lab).toEqual(srgbToLab({ r: 90, g: 120, b: 150 }));
    expect(result.dispersion).toEqual({ lMad: 0, aMad: 0, bMad: 0 });
  });
});
