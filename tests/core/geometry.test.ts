import { describe, expect, it } from "vitest";

import {
  circleToPixels,
  circlesOverlap,
  createContainTransform,
  getCircleIssues,
  getSamplePairIssues,
  normalizedPointToViewport,
  viewportPointToNormalized,
} from "../../miniprogram/core";

describe("normalized sample geometry", () => {
  it("normalizes centers per axis and radii by the image short edge", () => {
    expect(
      circleToPixels({ x: 0.5, y: 0.25, radius: 0.1 }, { width: 400, height: 200 }),
    ).toEqual({ x: 200, y: 50, radius: 20 });
  });

  it("rejects non-finite, non-positive, and out-of-bounds circles", () => {
    const size = { width: 100, height: 80 };
    expect(getCircleIssues({ x: Number.NaN, y: 0.5, radius: 0.1 }, size)).toEqual([
      "NON_FINITE",
    ]);
    expect(getCircleIssues({ x: 0.5, y: 0.5, radius: 0 }, size)).toEqual([
      "NON_POSITIVE_RADIUS",
    ]);
    expect(getCircleIssues({ x: 0.02, y: 0.5, radius: 0.1 }, size)).toEqual([
      "OUT_OF_BOUNDS",
    ]);
  });

  it("rejects overlap but permits circles that only touch", () => {
    const size = { width: 100, height: 100 };
    const first = { x: 0.3, y: 0.5, radius: 0.1 };
    const touching = { x: 0.5, y: 0.5, radius: 0.1 };
    const overlapping = { x: 0.49, y: 0.5, radius: 0.1 };

    expect(circlesOverlap(first, touching, size)).toBe(false);
    expect(getSamplePairIssues(first, touching, size)).toEqual([]);
    expect(getSamplePairIssues(first, overlapping, size)).toEqual([
      "OVERLAPPING_CIRCLES",
    ]);
  });

  it("reports each invalid circle without attempting an overlap calculation", () => {
    expect(
      getSamplePairIssues(
        { x: -1, y: 0.5, radius: 0.1 },
        { x: 2, y: 0.5, radius: 0.1 },
        { width: 100, height: 100 },
      ),
    ).toEqual(["INVALID_COVER_CIRCLE", "INVALID_REFERENCE_CIRCLE"]);
  });
});

describe("contain viewport transform", () => {
  it("round-trips points with letterboxing", () => {
    const image = { width: 400, height: 200 };
    const transform = createContainTransform(image, { width: 300, height: 300 });
    expect(transform).toEqual({
      scale: 0.75,
      displayedWidth: 300,
      displayedHeight: 150,
      offsetX: 0,
      offsetY: 75,
    });

    const viewport = normalizedPointToViewport({ x: 0.25, y: 0.75 }, image, transform);
    expect(viewport).toEqual({ x: 75, y: 187.5 });
    expect(viewportPointToNormalized(viewport, image, transform)).toEqual({
      x: 0.25,
      y: 0.75,
    });
  });

  it("returns null for points in the letterbox rather than sampling outside the image", () => {
    const image = { width: 400, height: 200 };
    const transform = createContainTransform(image, { width: 300, height: 300 });
    expect(viewportPointToNormalized({ x: 150, y: 20 }, image, transform)).toBeNull();
  });
});
